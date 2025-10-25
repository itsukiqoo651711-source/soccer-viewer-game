// server.js (サイド活用版)
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

// --- プレイヤーの初期化 (10人分) ---
for (let i = 0; i < 10; i++) {
    const playerId = `player${i}`;
    
    // 役割を決定 (GK, DF-L, DF-R, FW-L, FW-R)
    let role = 'FW-R'; // デフォルト
    if (i === 0 || i === 5) role = 'GK'; // 0, 5: GK
    if (i === 1 || i === 6) role = 'DF-L'; // 1, 6: DF-L (左)
    if (i === 2 || i === 7) role = 'DF-R'; // 2, 7: DF-R (右)
    if (i === 3 || i === 8) role = 'FW-L'; // 3, 8: FW-L (左)
    if (i === 4 || i === 9) role = 'FW-R'; // 4, 9: FW-R (右)

    gameState.players[playerId] = {
        id: playerId,
        x: Math.random() * FIELD_WIDTH,
        y: Math.random() * FIELD_HEIGHT,
        vx: 0,
        vy: 0,
        team: i < 5 ? 'home' : 'away',
        role: role, // ★役割にサイド情報を含める
        isBallHolder: false, 
        targetX: Math.random() * FIELD_WIDTH,
        targetY: Math.random() * FIELD_HEIGHT,
        stats: { 
            speed: 70 + Math.floor(Math.random() * 30),
            shot: 50 + Math.floor(Math.random() * 50),
            pass: 50 + Math.floor(Math.random() * 50)
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


// --- AIロジック (サイド活用版) ---
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
        
        // サイドポジションのY座標を決定
        let sideY;
        if (isLeft) {
            sideY = FIELD_HEIGHT * 0.25; // 上側 (左サイド)
        } else if (isRight) {
            sideY = FIELD_HEIGHT * 0.75; // 下側 (右サイド)
        } else {
            sideY = FIELD_HEIGHT * 0.5; // 中央
        }


        // --- ボール保持者 (ドリブル/シュート/パスの判断) ---
        if (player.isBallHolder) {
            
            const targetGoalX = (player.team === 'home') ? FIELD_WIDTH - 50 : 50;
            const targetGoalY = FIELD_HEIGHT / 2;
            const distToGoal = Math.sqrt(Math.pow(targetGoalX - player.x, 2) + Math.pow(targetGoalY - player.y, 2));

            // 1. パス候補の選定
            let passTarget = null;
            let bestPassScore = -Infinity;

            for (const otherId in gameState.players) {
                const otherPlayer = gameState.players[otherId];
                if (otherPlayer.team === player.team && otherPlayer.id !== player.id && otherPlayer.role !== 'GK') {
                    const otherDistToGoal = Math.sqrt(Math.pow(targetGoalX - otherPlayer.x, 2) + Math.pow(targetGoalY - otherPlayer.y, 2));
                    
                    let isOpen = true;
                    for (const opponentId in gameState.players) {
                        const opponent = gameState.players[opponentId];
                        if (opponent.team !== player.team) {
                            const distToOpponent = Math.sqrt(Math.pow(opponent.x - otherPlayer.x, 2) + Math.pow(opponent.y - otherPlayer.y, 2));
                            if (distToOpponent < 50) { 
                                isOpen = false;
                                break;
                            }
                        }
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
            if (player.role.startsWith('FW') || (player.role.startsWith('DF') && distToGoal < FIELD_WIDTH * 0.5)) { 
                
                const shotAttractiveness = (1 - distToGoal / FIELD_WIDTH) * 100;

                if (passTarget && bestPassScore > 0 && bestPassScore > shotAttractiveness * 0.5) { 
                    
                    if (Math.random() < 0.3) { 
                        const passVectorX = passTarget.x - player.x;
                        const passVectorY = passTarget.y - player.y;
                        const distToTarget = Math.sqrt(Math.pow(passVectorX, 2) + Math.pow(passVectorY, 2));

                        const passPower = (player.stats.pass / 100) * 12; 

                        gameState.ball.vx = (passVectorX / distToTarget) * passPower;
                        gameState.ball.vy = (passVectorY / distToTarget) * passPower;

                        player.isBallHolder = false;
                        console.log(`Pass: ${player.id} -> ${passTarget.id}`);
                        
                        player.targetX = player.x;
                        player.targetY = player.y;
                        player.vx = 0;
                        player.vy = 0;
                        continue; 
                    }
                } 

                if (distToGoal < 150 && Math.random() < (0.05 + (1 - distToGoal / FIELD_WIDTH) * 0.1)) {
                    const angleToGoal = Math.atan2(targetGoalY - player.y, targetGoalX - player.x);
                    const shotPower = (player.stats.shot / 100) * 15;
                    gameState.ball.vx = Math.cos(angleToGoal) * shotPower;
                    gameState.ball.vy = Math.sin(angleToGoal) * shotPower;
                    player.isBallHolder = false;
                    console.log(`Shot: ${player.id}`);
                    
                    player.targetX = player.x;
                    player.targetY = player.y;
                    player.vx = 0;
                    player.vy = 0;
                    continue; 
                }
            }

            // パスもシュートもしない場合はドリブル（ゴールに向かう）
            const angleToGoal = Math.atan2(targetGoalY - player.y, targetGoalX - player.x);
            player.targetX = player.x + Math.cos(angleToGoal) * PLAYER_SPEED;
            player.targetY = player.y + Math.sin(angleToGoal) * PLAYER_SPEED;

        } 
        // --- 非ボール保持者 (ポジションとボールへのアプローチ) ---
        else {
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

                    if (ballInDefenseArea && minDistanceToBall < 200) { 
                        player.targetX = gameState.ball.x;
                        player.targetY = gameState.ball.y;
                    } else {
                        player.targetX = defenseLineX;
                        // ★DFは自分のサイドY座標に固定して広がる
                        player.targetY = sideY;
                    }
                    break;

                case 'FW-L':
                case 'FW-R':
                    if (closestPlayerToBall && closestPlayerToBall.team === player.team) {
                        const supportOffset = player.team === 'home' ? -80 : 80; 
                        player.targetX = closestPlayerToBall.x + supportOffset;
                        // ★FWのサポート位置も自分のサイドY座標に固定
                        player.targetY = sideY + (Math.random() - 0.5) * 50; // 50pxのランダム幅
                    } 
                    else {
                         const attackLineX = (player.team === 'home') ? FIELD_WIDTH * 0.75 : FIELD_WIDTH * 0.25;
                         if (minDistanceToBall < 100) {
                            player.targetX = gameState.ball.x;
                            player.targetY = gameState.ball.y;
                         } else {
                            player.targetX = attackLineX;
                            // ★攻撃待機位置もサイドY座標に固定
                            player.targetY = sideY;
                         }
                    }
                    break;
                
                default:
                    // 何も役割が割り振られていない選手への安全策（このコードでは発生しないはず）
                    player.targetX = FIELD_WIDTH * 0.5;
                    player.targetY = FIELD_HEIGHT * 0.5;
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
    // ボールの移動、摩擦、境界・ゴール衝突判定 (省略)
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
            if (Math.abs(gameState.ball.vx) < 5 && Math.abs(gameState.ball.vy) < 5) {
                 gameState.ball.vx += player.vx * 0.5;
                 gameState.ball.vy += player.vy * 0.5;
                 player.isBallHolder = true; 
            }
        }
    }
}

// ゴール後のリセット (ランダム配置)
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
}


// --- Socket.IO接続ハンドリング、サーバー起動 ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startGameLoop();
});