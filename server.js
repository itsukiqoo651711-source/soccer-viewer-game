// server.js (最終・スルーパス搭載版)
const express = require('express');
const http = require('http'); 
const socketio = require('socket.io'); 

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// --- 静的ファイルの提供 ---
app.use(express.static('public'));

// --- ゲーム状態の初期値 ---
let gameState = {
    players: {},
    ball: { x: 400, y: 300, vx: 0, vy: 0 },
    score: { home: 0, away: 0 },
    time: 20 * 60,
    matchEnded: false
};

// --- ゲーム設定 ---
const FIELD_WIDTH = 800; 
const FIELD_HEIGHT = 600; 
const PLAYER_SPEED = 2.5; 
const BALL_DRAG = 0.98;
const CENTER_Y = FIELD_HEIGHT / 2;
const LEFT_SIDE_Y = FIELD_HEIGHT * 0.15; 
const RIGHT_SIDE_Y = FIELD_HEIGHT * 0.85; 

// --- プレイヤーの初期化 (10人分) ---
for (let i = 0; i < 10; i++) {
    const playerId = `player${i}`;
    
    let role = 'FW-R'; 
    if (i === 0 || i === 5) role = 'GK'; 
    if (i === 1 || i === 6) role = 'DF-L'; 
    if (i === 2 || i === 7) role = 'DF-R'; 
    if (i === 3 || i === 8) role = 'FW-L'; 
    if (i === 4 || i === 9) role = 'FW-R'; 

    gameState.players[playerId] = {
        id: playerId,
        x: Math.random() * FIELD_WIDTH,
        y: Math.random() * FIELD_HEIGHT,
        vx: 0,
        vy: 0,
        team: i < 5 ? 'home' : 'away',
        role: role, 
        isBallHolder: false, 
        targetX: Math.random() * FIELD_WIDTH,
        targetY: Math.random() * FIELD_HEIGHT,
        stats: { 
            speed: 70 + Math.floor(Math.random() * 30),
            shot: 50 + Math.floor(Math.random() * 50),
            pass: 50 + Math.floor(Math.random() * 50),
            dribble: 70 + Math.floor(Math.random() * 30),
            tackle: 70 + Math.floor(Math.random() * 30)
        }
    };
}

// --- ゲームループ（サーバー側） ---
const TICK_RATE = 60; 
const GAME_TICK_INTERVAL = 1000 / TICK_RATE;

let gameInterval; 

function startGameLoop() {
    if (gameInterval) clearInterval(gameInterval); 

    let tickCount = 0;
    resetBallAndPlayers(true);

    gameInterval = setInterval(() => {
        if (gameState.matchEnded) {
            clearInterval(gameInterval);
            return;
        }

        updateAI();
        updatePhysics();

        tickCount++;
        if (tickCount >= TICK_RATE) {
            if (gameState.time > 0) {
                gameState.time--;
            } else {
                gameState.matchEnded = true;
                io.emit('game_over', gameState.score);
                console.log('Match Ended:', gameState.score);
            }
            tickCount = 0;
        }

        io.emit('game_state_update', gameState);

    }, GAME_TICK_INTERVAL);
}

// --- 簡易的な「スペース」チェック関数 ---
function countOpponentsNear(x, y, team) {
    let count = 0;
    for (const id in gameState.players) {
        const p = gameState.players[id];
        if (p.team !== team && p.role !== 'GK') {
            const dist = Math.sqrt(Math.pow(p.x - x, 2) + Math.pow(p.y - y, 2));
            if (dist < 100) {
                count++;
            }
        }
    }
    return count;
}


// --- AIロジック (最終・スルーパス搭載版) ---
function updateAI() {
    let closestPlayerToBall = null;
    let minDistanceToBall = Infinity;

    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (player.role === 'GK') continue; 

        const dist = Math.sqrt(
            Math.pow(player.x - gameState.ball.x, 2) +
            Math.pow(player.y - gameState.ball.y, 2)
        );
        if (dist < minDistanceToBall) {
            minDistanceToBall = dist;
            closestPlayerToBall = player;
        }
    }

    for (const id in gameState.players) {
        const player = gameState.players[id];
        player.isBallHolder = (closestPlayerToBall && closestPlayerToBall.id === player.id && minDistanceToBall < 20);
        player.targetX = player.x;
        player.targetY = player.y;

        const isLeft = player.role.endsWith('-L');
        const isRight = player.role.endsWith('-R');
        const targetGoalX = (player.team === 'home') ? FIELD_WIDTH - 50 : 50;
        const targetGoalY = CENTER_Y;
        
        let mySideY;
        if (isLeft) {
            mySideY = LEFT_SIDE_Y;
        } else if (isRight) {
            mySideY = RIGHT_SIDE_Y;
        } else {
            mySideY = CENTER_Y;
        }


        // --- ボール保持者 (ドリブル/シュート/パスの判断) ---
        if (player.isBallHolder) {
            
            const distToGoal = Math.sqrt(Math.pow(targetGoalX - player.x, 2) + Math.pow(targetGoalY - player.y, 2));

            // 1. パス候補の選定
            let passTarget = null;
            let bestPassScore = -Infinity;

            for (const otherId in gameState.players) {
                const otherPlayer = gameState.players[otherId];
                if (otherPlayer.team === player.team && otherPlayer.id !== player.id && otherPlayer.role !== 'GK') {
                    const otherDistToGoal = Math.sqrt(Math.pow(targetGoalX - otherPlayer.x, 2) + Math.pow(targetGoalY - otherPlayer.y, 2));
                    
                    let isOpen = true;
                    if (countOpponentsNear(otherPlayer.x, otherPlayer.y, otherPlayer.team) > 0) {
                        isOpen = false;
                    }
                    if (isOpen) {
                        const score = (FIELD_WIDTH - otherDistToGoal) * 1.5; 
                        
                        if (score > bestPassScore) {
                            bestPassScore = score;
                            passTarget = otherPlayer;
                        }
                    }
                }
            }
            
            // 2. 行動の決定 (シュート vs パス vs ドリブル)
            const shotAttractiveness = (1 - distToGoal / FIELD_WIDTH) * 100;

            // パスの試行
            if (passTarget && bestPassScore > 0 && bestPassScore > shotAttractiveness * 0.5 && Math.random() < 0.3) { 
                
                // ★スルーパスロジック：ターゲットの移動ベクトルを予測
                const PREDICTION_FRAMES = 50; // 50フレーム先の位置を予測（約0.8秒後）
                
                let predictedX = passTarget.x + passTarget.vx * PREDICTION_FRAMES;
                let predictedY = passTarget.y + passTarget.vy * PREDICTION_FRAMES;
                
                // フィールド境界で予測位置をクランプ
                predictedX = Math.max(10, Math.min(FIELD_WIDTH - 10, predictedX));
                predictedY = Math.max(10, Math.min(FIELD_HEIGHT - 10, predictedY));

                const passVectorX = predictedX - player.x; // 予測位置へパス
                const passVectorY = predictedY - player.y;
                const distToTarget = Math.sqrt(Math.pow(passVectorX, 2) + Math.pow(passVectorY, 2));

                const passPower = (player.stats.pass / 100) * 12; 

                gameState.ball.vx = (passVectorX / distToTarget) * passPower;
                gameState.ball.vy = (passVectorY / distToTarget) * passPower;

                player.isBallHolder = false;
                console.log(`Through Pass: ${player.id} -> ${passTarget.id}`);
                
                continue; 
            } 

            // シュートの試行
            // ★修正点：シュートレンジを300pxに拡大
            if (distToGoal < 300 && Math.random() < (0.1 + (1 - distToGoal / FIELD_WIDTH) * 0.15)) {
                const angleToGoal = Math.atan2(targetGoalY - player.y, targetGoalX - player.x);
                const shotPower = (player.stats.shot / 100) * 15;
                gameState.ball.vx = Math.cos(angleToGoal) * shotPower;
                gameState.ball.vy = Math.sin(angleToGoal) * shotPower;
                player.isBallHolder = false;
                console.log(`Shot: ${player.id}`);
                
                continue; 
            }

            // ドリブル (パスもシュートもしない場合)
            const opponentsInCenter = countOpponentsNear(player.x, CENTER_Y, player.team);
            
            if (opponentsInCenter > 1 && distToGoal > 200) {
                player.targetX = player.x + (targetGoalX - player.x) * 0.1; 
                player.targetY = mySideY;
            } else {
                player.targetX = targetGoalX;
                player.targetY = targetGoalY;
            }

        } 
        // --- 非ボール保持者 (ポジションとボールへのアプローチ) ---
        else {
            // ... (非保持者のロジックは省略) ...
            
            switch (player.role) {
                case 'GK':
                    const goalLineX = (player.team === 'home') ? 50 : FIELD_WIDTH - 50;
                    player.targetX = goalLineX;
                    player.targetY = Math.max(FIELD_HEIGHT * 0.25, Math.min(FIELD_HEIGHT * 0.75, gameState.ball.y));
                    break;

                case 'DF-L':
                case 'DF-R':
                    const defenseLineX = (player.team === 'home') ? FIELD_WIDTH * 0.25 : FIELD_WIDTH * 0.75;
                    const ballInDefenseArea = (player.team === 'home' && gameState.ball.x < FIELD_WIDTH / 2) || 
                                              (player.team === 'away' && gameState.ball.x > FIELD_WIDTH / 2);

                    if (ballInDefenseArea && minDistanceToBall < 150) { 
                        player.targetX = gameState.ball.x;
                        player.targetY = gameState.ball.y;
                    } else {
                        player.targetX = defenseLineX;
                        player.targetY = mySideY;
                    }
                    break;

                case 'FW-L':
                case 'FW-R':
                    const attackLineX = (player.team === 'home') ? FIELD_WIDTH * 0.75 : FIELD_WIDTH * 0.25;

                    if (closestPlayerToBall && closestPlayerToBall.team === player.team) {
                        
                        const ballIsLeft = gameState.ball.y < CENTER_Y;
                        const ballIsRight = gameState.ball.y > CENTER_Y;

                        if ((isLeft && ballIsRight) || (isRight && ballIsLeft)) {
                            player.targetX = attackLineX;
                            player.targetY = mySideY;
                        } else {
                            const supportOffset = player.team === 'home' ? -80 : 80; 
                            player.targetX = closestPlayerToBall.x + supportOffset;
                            player.targetY = mySideY + (Math.random() - 0.5) * 50;
                        }
                        
                    } 
                    else {
                         const attackLineX = (player.team === 'home') ? FIELD_WIDTH * 0.75 : FIELD_WIDTH * 0.25;
                         if (minDistanceToBall < 100) {
                            player.targetX = gameState.ball.x;
                            player.targetY = gameState.ball.y;
                         } else {
                            player.targetX = attackLineX;
                            player.targetY = mySideY;
                         }
                    }
                    break;
                
                default:
                    player.targetX = FIELD_WIDTH * 0.5;
                    player.targetY = CENTER_Y;
                    break;
            }
        }
        
        // --- 共通の移動処理 ---
        const angleToTarget = Math.atan2(player.targetY - player.y, player.targetX - player.x);
        const distToTarget = Math.sqrt(Math.pow(player.targetX - player.x, 2) + Math.pow(player.targetY - player.y, 2));
        
        if (distToTarget > 1) { 
            const speedFactor = 0.5 + (player.stats.speed / 200); 
            player.vx = Math.cos(angleToTarget) * PLAYER_SPEED * speedFactor;
            player.vy = Math.sin(angleToTarget) * PLAYER_SPEED * speedFactor;
        } else {
            player.vx = (Math.random() - 0.5) * 0.1;
            player.vy = (Math.random() - 0.5) * 0.1;
        }
    }
    
    // --- ドリブル突破判定 ---
    if (closestPlayerToBall && closestPlayerToBall.isBallHolder) {
        const dribbler = closestPlayerToBall;
        for (const id in gameState.players) {
            const opponent = gameState.players[id];
            if (opponent.team !== dribbler.team && opponent.role !== 'GK') {
                const dist = Math.sqrt(Math.pow(opponent.x - dribbler.x, 2) + Math.pow(opponent.y - dribbler.y, 2));
                
                if (dist < 20) { // 接触した場合
                    const dribbleSkill = dribbler.stats.dribble;
                    const tackleSkill = opponent.stats.tackle;
                    
                    // ★修正点：ドリブル成功確率に1.5倍の補正を適用
                    const breakthroughChance = (dribbleSkill / (dribbleSkill + tackleSkill)) * 1.5; 
                    
                    if (Math.random() > breakthroughChance) { 
                        // 突破失敗: ボールロスト
                        dribbler.isBallHolder = false;
                        gameState.ball.vx = opponent.vx * 0.5; 
                        gameState.ball.vy = opponent.vy * 0.5;
                        console.log(`Tackle: ${opponent.id} WINS over ${dribbler.id}`);
                        
                        dribbler.vx *= -0.5;
                        dribbler.vy *= -0.5;
                        
                        return;
                    } else {
                        // 突破成功
                        console.log(`Dribble: ${dribbler.id} BREAKS ${opponent.id}`);
                        opponent.vx *= -1.5;
                        opponent.vy *= -1.5;
                    }
                }
            }
        }
    }
}


// --- 物理演算 ---
function updatePhysics() {
    for (const id in gameState.players) {
        const player = gameState.players[id];
        player.x += player.vx;
        player.y += player.vy;
        player.x = Math.max(10, Math.min(FIELD_WIDTH - 10, player.x));
        player.y = Math.max(10, Math.min(FIELD_HEIGHT - 10, player.y));

        if (player.isBallHolder) {
            gameState.ball.x = player.x + (player.team === 'home' ? 10 : -10); 
            gameState.ball.y = player.y;
            gameState.ball.vx = player.vx;
            gameState.ball.vy = player.vy;
        }
    }
    gameState.ball.x += gameState.ball.vx;
    gameState.ball.y += gameState.ball.vy;
    gameState.ball.vx *= BALL_DRAG;
    gameState.ball.vy *= BALL_DRAG;

    const GOAL_TOP_Y = FIELD_HEIGHT / 2 - 50;
    const GOAL_BOTTOM_Y = FIELD_HEIGHT / 2 + 50;
    let goalScored = false;
    
    if (gameState.ball.x < 0) {
        if (gameState.ball.y > GOAL_TOP_Y && gameState.ball.y < GOAL_BOTTOM_Y) { gameState.score.home++; goalScored = true; console.log("Goal! Home team scored.");} else { gameState.ball.x = 0; gameState.ball.vx *= -0.8; }
    }
    if (gameState.ball.x > FIELD_WIDTH) {
        if (gameState.ball.y > GOAL_TOP_Y && gameState.ball.y < GOAL_BOTTOM_Y) { gameState.score.away++; goalScored = true; console.log("Goal! Away team scored.");} else { gameState.ball.x = FIELD_WIDTH; gameState.ball.vx *= -0.8; }
    }
    if (gameState.ball.y < 0) { gameState.ball.y = 0; gameState.ball.vy *= -0.8; }
    if (gameState.ball.y > FIELD_HEIGHT) { gameState.ball.y = FIELD_HEIGHT; gameState.ball.vy *= -0.8; }

    if (goalScored) { resetBallAndPlayers(); return; }

    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (player.isBallHolder) continue; 
        const dist = Math.sqrt(Math.pow(player.x - gameState.ball.x, 2) + Math.pow(player.y - gameState.ball.y, 2));
        
        if (player.role === 'GK' && dist < 25) { 
            gameState.ball.vx *= -1.5; gameState.ball.vy *= -1.5;
            player.isBallHolder = false;
        } 
        else if (player.role !== 'GK' && dist < 20) { 
            if (Math.abs(gameState.ball.vx) < 10 && Math.abs(gameState.ball.vy) < 10) {
                 gameState.ball.vx += player.vx * 0.5;
                 gameState.ball.vy += player.vy * 0.5;
                 player.isBallHolder = true; 
            }
        }
    }
}

// ゴール後のリセット (ボール強制放出機能追加)
function resetBallAndPlayers(isInitialStart = false) {
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
         gameState.ball = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0 };
    }
    
    for (const id in gameState.players) {
        const player = gameState.players[id];
        player.x = Math.random() * FIELD_WIDTH; 
        player.y = Math.random() * FIELD_HEIGHT;
        player.vx = 0;
        player.vy = 0;
        player.isBallHolder = false;
        player.targetX = player.x;
        player.targetY = player.y;
    }
    
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
        gameState.ball.x = FIELD_WIDTH / 2;
        gameState.ball.y = CENTER_Y;
        
        gameState.ball.vx = 10;
        gameState.ball.vy = 0; 
        
        for (const id in gameState.players) {
            gameState.players[id].isBallHolder = false;
        }
    }
}


// --- Socket.IO接続ハンドリング、サーバー起動 ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startGameLoop();
});