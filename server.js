// server.js (v3.6 - 浮き球パス ＆ 高さ制限 最終版)
const express = require('express');
const http = require('http');
const socketio = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketio(server);

app.use(express.static('public'));

// --- グローバルステータス/フラグ ---
let isPaused = false; 
let gameTickTimer = null;
let closestPlayerToBall = null; 
let kickOffTeam = 'home';
let kickOffPlayerId = 'player6';
let lastScorer = null; 
let currentHolderId = null; 

// --- ゲーム状態の初期値 ---
let gameState = {
    players: {},
    // ★★★ 修正 (NaNバグ): z: 0, vz: 0 を初期値に必ず含める
    ball: { x: 400, y: 300, vx: 0, vy: 0, z: 0, vz: 0 }, 
    score: { home: 0, away: 0 },
    time: 3 * 60,
    matchEnded: false,
    scorers: []
};

// --- ゲーム設定 ---
const FIELD_WIDTH = 800;
const FIELD_HEIGHT = 600;
const PLAYER_COUNT = 16;
const GLOBAL_SPEED_FACTOR = 0.7; 
const PLAYER_SPEED = 2.0 * GLOBAL_SPEED_FACTOR; // v3.3
const BALL_DRAG = 0.98; 
const CENTER_Y = FIELD_HEIGHT / 2;
const SIDE_Y_L = FIELD_HEIGHT * 0.25;
const SIDE_Y_R = FIELD_HEIGHT * 0.75;
const BALL_SPEED_FACTOR = 0.96; // v3.3
const PLAYER_KICK_RANGE = 20; 
const PLAYER_SHOT_RANGE_DEFAULT = 300; 
const GOAL_POST_Y_TOP = FIELD_HEIGHT * 0.35; 
const GOAL_POST_Y_BOTTOM = FIELD_HEIGHT * 0.65; 
const GOAL_LINE_X_HOME = 30; 
const GOAL_LINE_X_AWAY = FIELD_WIDTH - 30;
const AI_DEFAULT_CHASE_DISTANCE = 150; 
const AI_PASS_RANGE = 250; 
const AI_FREE_SPACE_DISTANCE = 70; 
const AI_PASS_ROUTE_CLEARANCE = 20; 

// ★★★ フェーズ4 (要求1): 高さの定義 ★★★
const PLAYER_KICK_HEIGHT = 10; // 選手はこの高さ(z)以下のボールしか触れない
const GK_CATCH_HEIGHT = 20;    // GKはこの高さ(z)までキャッチ可能
const GOAL_HEIGHT = 50;        // この高さ(z)より低いボールのみゴールと判定


// グローバル定数としてポジションを定義 (変更なし)
const HOME_POSITIONS = {
    'player0': [60, CENTER_Y], 'player1': [200, SIDE_Y_L], 'player2': [200, SIDE_Y_R],
    'player3': [350, CENTER_Y], 'player4': [350, SIDE_Y_L], 'player5': [350, SIDE_Y_R],
    'player6': [FIELD_WIDTH / 2 - 50, CENTER_Y - 50], 'player7': [FIELD_WIDTH / 2 - 50, CENTER_Y + 50]
};
const AWAY_POSITIONS = {
    'player8': [FIELD_WIDTH - 60, CENTER_Y], 'player9': [FIELD_WIDTH - 200, SIDE_Y_L], 'player10': [FIELD_WIDTH - 200, SIDE_Y_R],
    'player11': [FIELD_WIDTH - 350, CENTER_Y], 'player12': [FIELD_WIDTH - 350, SIDE_Y_L], 'player13': [FIELD_WIDTH - 350, SIDE_Y_R],
    'player14': [FIELD_WIDTH / 2 + 50, CENTER_Y - 50], 'player15': [FIELD_WIDTH / 2 + 50, CENTER_Y + 50]
};


// --- E-Sランク変換関数 (変更なし) ---
function toRank(value) {
    if (value >= 250) return 'S';
    if (value >= 150) return 'A';
    if (value >= 120) return 'B';
    if (value >= 90) return 'C';
    if (value >= 60) return 'D';
    return 'E';
}

// --- プレイヤーの初期化 (変更なし) ---
for (let i = 0; i < PLAYER_COUNT; i++) {
    const playerId = `player${i}`;
    const isHome = i < 8;
    let imageKey = isHome ? 'player_home' : 'player_away';
    let role = 'FW';
    let speedMult = 1;
    let dribbleMult = 1;
    let shotRangeMult = 1;
    let shotMult = 1;
    let displayName = playerId;

    if (i === 0) { role = 'GK'; imageKey = 'keeper_home';
    } else if (i === 8) { role = 'GK'; imageKey = 'keeper_away';
    } else if (i === 7) { role = 'FW-R'; imageKey = 'Sakuraba_home'; displayName = 'Sakuraba';
        speedMult = 1.5; dribbleMult = 3; shotRangeMult = 1.5; 
    } else if (i === 3) { role = 'MF-C'; imageKey = 'Gouda_home'; displayName = 'Gouda';
        speedMult = 1.5; dribbleMult = 5; shotRangeMult = 1.5; 
    } else if (i === 14) { role = 'FW-L'; imageKey = 'Zoro_away'; displayName = 'Zoro';
        speedMult = 1.2; shotMult = 2; shotRangeMult = 1.3; 
    } else if (i === 11) { role = 'MF-C'; imageKey = 'Itoshi_away'; displayName = 'Itoshi';
        dribbleMult = 10; shotRangeMult = 2;
    } else if (i === 1) { role = 'DF-L';
    } else if (i === 2) { role = 'DF-R';
    } else if (i === 4) { role = 'MF-L'; 
    } else if (i === 5) { role = 'MF-R'; 
    } else if (i === 6) { role = 'FW-L';
    } else if (i === 9) { role = 'DF-L';
    } else if (i === 10) { role = 'DF-R';
    } else if (i === 12) { role = 'MF-L'; 
    } else if (i === 13) { role = 'MF-R'; 
    } else if (i === 15) { role = 'FW-R';
    }

    const baseSpeed = 70 + Math.floor(Math.random() * 30);
    const baseShot = 50 + Math.floor(Math.random() * 50);
    const baseDribble = 70 + Math.floor(Math.random() * 30);
    const baseTackle = 70 + Math.floor(Math.random() * 30);
    const finalSpeed = baseSpeed * speedMult;
    const finalShot = baseShot * shotMult;
    const finalDribble = baseDribble * dribbleMult;

    gameState.players[playerId] = {
        id: playerId,
        displayName: displayName.startsWith('player') ? playerId : displayName,
        x: Math.random() * FIELD_WIDTH,
        y: Math.random() * FIELD_HEIGHT,
        vx: 0, vy: 0, team: isHome ? 'home' : 'away', role: role,
        imageKey: imageKey, isBallHolder: false,
        targetX: Math.random() * FIELD_WIDTH, targetY: Math.random() * FIELD_HEIGHT,
        stats: {
            speed: finalSpeed, shot: finalShot, pass: 80,
            dribble: finalDribble, tackle: baseTackle, shotRangeMult: shotRangeMult
        },
        ranks: {
            spd: toRank(finalSpeed), sht: toRank(finalShot), pas: toRank(80),
            drb: toRank(finalDribble), tck: toRank(baseTackle)
        }
    };
}


// --- ゲームループ（サーバー側） (変更なし) ---
const TICK_RATE = 60;
const GAME_TICK_INTERVAL = 1000 / TICK_RATE;

function startGameLoop() {
    console.log("[Server] Starting game loop...");
    if (gameTickTimer) clearInterval(gameTickTimer);
    let tickCount = 0;
    resetBallAndPlayers(true); 

    gameTickTimer = setInterval(() => {
        if (gameState.matchEnded) {
            clearInterval(gameTickTimer);
            return;
        }
        if (!isPaused) { 
            try {
                updateAI();
                updatePhysics();
                tickCount++;
                if (tickCount >= TICK_RATE) {
                    if (gameState.time > 0) {
                        gameState.time--;
                    } else {
                        gameState.matchEnded = true;
                        io.emit('game_message', { type: 'END', score: gameState.score });
                        isPaused = true; 
                    }
                    tickCount = 0;
                }
            } catch (error) {
                console.error("[Server Error] Error within game loop:", error);
                clearInterval(gameTickTimer);
                return;
            }
        }
        io.emit('game_state_update', gameState);
    }, GAME_TICK_INTERVAL);
}

// --- AIロジック v3.6 ---

// 補助関数: プレイヤーがフリーかチェック (変更なし)
function isPlayerFree(player) {
    for (const id in gameState.players) {
        const opponent = gameState.players[id];
        if (opponent.team !== player.team) {
            const dist = Math.hypot(player.x - opponent.x, player.y - opponent.y);
            if (dist < AI_FREE_SPACE_DISTANCE) {
                return false; 
            }
        }
    }
    return true; 
}

// 補助関数: プレイヤーに一番近い敵を探す (変更なし)
function findNearestOpponent(player) {
    let closestDist = Infinity;
    let nearestOpponent = null;
    for (const id in gameState.players) {
        const opponent = gameState.players[id];
        if (opponent.team !== player.team) {
            const dist = Math.hypot(player.x - opponent.x, player.y - opponent.y);
            if (dist < closestDist) {
                closestDist = dist;
                nearestOpponent = opponent;
            }
        }
    }
    return nearestOpponent;
}


// 補助関数: パスルートが敵によってブロックされていないかチェック (変更なし)
function isPassRouteClear(passer, targetPlayer) {
    const pX = passer.x;
    const pY = passer.y;
    const tX = targetPlayer.x;
    const tY = targetPlayer.y;

    const lineLengthSq = Math.pow(tX - pX, 2) + Math.pow(tY - pY, 2);
    if (lineLengthSq < (AI_PASS_ROUTE_CLEARANCE * AI_PASS_ROUTE_CLEARANCE)) {
        return true;
    }

    for (const id in gameState.players) {
        const opponent = gameState.players[id];
        if (opponent.team === passer.team) continue; 

        const oX = opponent.x;
        const oY = opponent.y;

        if (oX < Math.min(pX, tX) - AI_PASS_ROUTE_CLEARANCE ||
            oX > Math.max(pX, tX) + AI_PASS_ROUTE_CLEARANCE ||
            oY < Math.min(pY, tY) - AI_PASS_ROUTE_CLEARANCE ||
            oY > Math.max(pY, tY) + AI_PASS_ROUTE_CLEARANCE) {
            continue;
        }

        const t = ((oX - pX) * (tX - pX) + (oY - pY) * (tY - pY)) / lineLengthSq;
        let closestX, closestY;

        if (t < 0) {
            closestX = pX;
            closestY = pY;
        } else if (t > 1) {
            closestX = tX;
            closestY = tY;
        } else {
            closestX = pX + t * (tX - pX);
            closestY = pY + t * (tY - pY);
        }

        const distToLine = Math.hypot(oX - closestX, oY - closestY);
        
        if (distToLine < AI_PASS_ROUTE_CLEARANCE) {
            return false; 
        }
    }
    
    return true; 
}


// 補助関数: 最も「期待値の高い」パス相手を探す (フェーズ3修正)
function findBestPassTarget(passer, rolesToFind) {
    let bestScore = -Infinity;
    let targetPlayer = null;
    const myTeam = passer.team;
    const enemyGoalX = (myTeam === 'home') ? FIELD_WIDTH : 0;
    const enemyGoalY = CENTER_Y;

    // GKのパスロジック (ロブパスを考慮)
    if (passer.role === 'GK') {
        let closestDist = Infinity;
        let bestLobTarget = null;
        let bestLobScore = -Infinity;

        for (const id in gameState.players) {
            const teammate = gameState.players[id];
            if (teammate.team === myTeam && teammate.id !== passer.id && rolesToFind.includes(teammate.role.split('-')[0])) {
                const dist = Math.hypot(passer.x - teammate.x, passer.y - teammate.y);

                if (dist < AI_PASS_RANGE && isPlayerFree(teammate)) {
                    // 1. 安全な地上パス (DF/MF)
                    if (teammate.role.startsWith('DF') || teammate.role.startsWith('MF')) {
                        if (dist < closestDist && isPassRouteClear(passer, teammate)) {
                            closestDist = dist;
                                targetPlayer = teammate; // 地上パスの候補
                        }
                    }
                    // 2. ロブパス (FW/MF)
                    else if (teammate.role.startsWith('FW') || teammate.role.startsWith('MF')) {
                        const distToGoal = Math.hypot(teammate.x - enemyGoalX, teammate.y - enemyGoalY);
                        const score = (FIELD_WIDTH - distToGoal); // ゴールに近いほど高評価
                        if (score > bestLobScore) {
                            bestLobScore = score;
                            bestLobTarget = teammate;
                        }
                    }
                }
            }
        }
        // 地上パスの相手がいれば最優先、いなければロブパス
        return targetPlayer ? targetPlayer : bestLobTarget; 
    }

    // フィールドプレイヤーのパスロジック (ロブパスを考慮)
    for (const id in gameState.players) {
        const teammate = gameState.players[id];
        if (teammate.team === myTeam && teammate.id !== passer.id && rolesToFind.includes(teammate.role.split('-')[0])) {
            const distToPasser = Math.hypot(passer.x - teammate.x, passer.y - teammate.y);
            if (distToPasser < AI_PASS_RANGE) {
                const freeBonus = isPlayerFree(teammate) ? 100 : 0;
                const distToGoal = Math.hypot(teammate.x - enemyGoalX, teammate.y - enemyGoalY);
                const goalBonus = (FIELD_WIDTH - distToGoal); 
                const routeClearBonus = isPassRouteClear(passer, teammate) ? 50 : -200; 

                let passScore = freeBonus + goalBonus + routeClearBonus;

                // ★ 浮き球の評価を追加
                // もし地上パスが危険 (routeClearBonus < 0) で、
                // パサーがDF/MFで、相手がFWなら、浮き球を再評価
                if (routeClearBonus < 0 && 
                    (passer.role.startsWith('DF') || passer.role.startsWith('MF')) && 
                    teammate.role.startsWith('FW')) 
                {
                    // 浮き球はカットされにくいので、ルート評価を無視し、距離ボーナスを加える
                    const distBonus = (distToPasser / AI_PASS_RANGE) * 50; // 遠いほど高評価
                    passScore = freeBonus + goalBonus + distBonus; 
                }

                if (passScore > bestScore) {
                    bestScore = passScore;
                    targetPlayer = teammate;
                }
            }
        }
    }
    return targetPlayer;
}

// ★★★ フェーズ3: makePass に isLobbed 引数を追加 ★★★
function makePass(player, targetPlayer, isLobbed = false) {
    const basePassPower = 12; // v3.3
    const passPower = basePassPower * (player.stats.pass / 100);
    const targetX = targetPlayer.x + targetPlayer.vx * 5;
    const targetY = targetPlayer.y + targetPlayer.vy * 5;
    const distToTarget = Math.hypot(targetY - player.y, targetX - player.x);

    const angle = Math.atan2(targetY - player.y, targetX - player.x);
    gameState.ball.vx = Math.cos(angle) * passPower * GLOBAL_SPEED_FACTOR;
    gameState.ball.vy = Math.sin(angle) * passPower * GLOBAL_SPEED_FACTOR;
    
    if (isLobbed) {
        // 距離に応じて高さを変える (5〜13程度)
        gameState.ball.vz = 5 + (distToTarget / 50); 
    } else {
        gameState.ball.vz = 0; // 地上パス
    }

    player.isBallHolder = false;
    currentHolderId = null; 
    closestPlayerToBall = null;
    console.log(`[Server AI] ${player.displayName} passed to ${targetPlayer.displayName} (Lob: ${isLobbed})`);
}


function updateAI() {
    let minDistance = Infinity;
    let closestPlayerId = null;
    let newHolderId = null;

    // 1. ボールに最も近いプレイヤーを探す (変更なし)
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const distance = Math.hypot(player.x - gameState.ball.x, player.y - gameState.ball.y);
        if (distance < minDistance) {
            minDistance = distance;
            closestPlayerId = id;
        }
    }

    // ★★★ フェーズ4 (要求1): 高さ制限を導入 ★★★
    // 2. ボールホルダーを決定
    if (minDistance < PLAYER_KICK_RANGE) {
        if (!closestPlayerId) return; 
        const closer = gameState.players[closestPlayerId];
        const current = gameState.players[currentHolderId];

        let canTouch = false;
        if (closer.role === 'GK') {
            canTouch = gameState.ball.z < GK_CATCH_HEIGHT;
        } else {
            canTouch = gameState.ball.z < PLAYER_KICK_HEIGHT;
        }
        
        if (canTouch) { // ★ボールが触れる高さの場合のみ
            if (current && current.role === 'GK' && current.team !== closer.team && gameState.ball.z < GK_CATCH_HEIGHT) {
                newHolderId = currentHolderId; // GK無敵ロジック
            } else {
                newHolderId = closestPlayerId;
            }
        } else { // ★ボールが高すぎて触れない
            newHolderId = null; 
        }

    } else {
        newHolderId = null; 
    }
    // ★★★ 修正ここまで ★★★

    // 3. 全プレイヤーの isBallHolder 状態を更新 (変更なし)
    currentHolderId = newHolderId; 
    closestPlayerToBall = newHolderId; 
    for (const id in gameState.players) {
        if (id === newHolderId) {
            gameState.players[id].isBallHolder = true;
            lastScorer = id; 
        } else {
            gameState.players[id].isBallHolder = false;
        }
    }

    // 4. 各プレイヤーの行動AI
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const myTeam = player.team;
        const enemyGoalX = (myTeam === 'home') ? FIELD_WIDTH : 0;
        const enemyGoalY = CENTER_Y;
        const myGoalX = (myTeam === 'home') ? 0 : FIELD_WIDTH;
        const basePos = (myTeam === 'home') ? HOME_POSITIONS[id] : AWAY_POSITIONS[id];
        const distToBall = Math.hypot(player.x - gameState.ball.x, player.y - gameState.ball.y);
        const teamHasBall = currentHolderId && gameState.players[currentHolderId] && gameState.players[currentHolderId].team === myTeam;

        // --- ボールを持っている場合 ---
        if (player.isBallHolder) {
            
            // GKのパスロジック (フェーズ3修正)
            if (player.role === 'GK') {
                // GKはFWやMF（フリーな味方）を探す
                const targetPlayer = findBestPassTarget(player, ['DF', 'MF', 'FW']);
                if (targetPlayer) {
                    // 相手がDF/MFなら地上パス、FWならロブパス
                    const isLobbed = targetPlayer.role.startsWith('FW');
                    makePass(player, targetPlayer, isLobbed);
                } else {
                    // クリア（常にロブパス）
                    const angle = Math.atan2(CENTER_Y - player.y, enemyGoalX - player.x);
                    gameState.ball.vx = Math.cos(angle) * 12; // v3.3
                    gameState.ball.vy = Math.sin(angle) * 12; // v3.3
                    gameState.ball.vz = 10; // クリアの高さ
                    player.isBallHolder = false; currentHolderId = null; closestPlayerToBall = null;
                }
                continue;
            }

            // シュート判定 (要求2修正)
            const distanceToGoal = Math.hypot(player.x - enemyGoalX, player.y - enemyGoalY);
            const shotRange = PLAYER_SHOT_RANGE_DEFAULT * (player.stats.shotRangeMult || 1);
            if (distanceToGoal < shotRange) {
                const baseShotPower = 18; // v3.3
                const shotPower = baseShotPower * (player.stats.shot / 100) * (player.stats.shotMult || 1);
                const targetYAdjust = (Math.random() - 0.5) * (GOAL_POST_Y_BOTTOM - GOAL_POST_Y_TOP);
                const angleAdjusted = Math.atan2((enemyGoalY + targetYAdjust) - player.y, enemyGoalX - player.x);
                gameState.ball.vx = Math.cos(angleAdjusted) * shotPower * GLOBAL_SPEED_FACTOR;
                gameState.ball.vy = Math.sin(angleAdjusted) * shotPower * GLOBAL_SPEED_FACTOR;
                gameState.ball.vz = 2; // シュートは低く (少しだけ浮かす)
                player.isBallHolder = false; currentHolderId = null; closestPlayerToBall = null;
                continue;
            }

            // パス判定 (DF/MF/FW) (フェーズ3修正)
            if (player.role.startsWith('DF') || player.role.startsWith('MF') || player.role.startsWith('FW')) {
                const targetPlayer = findBestPassTarget(player, ['FW', 'MF']);
                if (targetPlayer) {
                    // DFからFWへ、またはMFからFWへのパスで、地上ルートが危険な場合はロブパス
                    const isLobbed = (player.role.startsWith('DF') && targetPlayer.role.startsWith('FW')) ||
                                     (player.role.startsWith('MF') && targetPlayer.role.startsWith('FW') && !isPassRouteClear(player, targetPlayer));
                    makePass(player, targetPlayer, isLobbed);
                    continue;
                }
            }

            // デフォルト: ゴールに向かってドリブル
            player.targetX = enemyGoalX;
            player.targetY = enemyGoalY;
        } 
        // --- ボールを持っていない場合 ---
        else {
            // GKの守備
            if (player.role === 'GK') {
                player.targetX = (myTeam === 'home') ? GOAL_LINE_X_HOME + 20 : GOAL_LINE_X_AWAY - 20;
                player.targetY = Math.max(GOAL_POST_Y_TOP, Math.min(GOAL_POST_Y_BOTTOM, gameState.ball.y));
                continue;
            }
            
            // FWのポジショニング (変更なし)
            if (player.role.startsWith('FW')) {
                const centerLineX = FIELD_WIDTH / 2;
                let targetX = player.x; 
                let targetY = player.y; 
                
                if (teamHasBall) {
                    const nearestOpponent = findNearestOpponent(player);
                    if (nearestOpponent) {
                        const angleToOpponent = Math.atan2(nearestOpponent.y - player.y, nearestOpponent.x - player.x);
                        targetX = player.x - Math.cos(angleToOpponent) * 50;
                        targetY = player.y - Math.sin(angleToOpponent) * 50;
                    } else if (basePos) {
                        targetX = basePos[0] + (myTeam === 'home' ? 50 : -50);
                        targetY = basePos[1];
                    } else {
                        targetX = enemyGoalX;
                        targetY = enemyGoalY;
                    }
                } else {
                    if (basePos) {
                        targetX = basePos[0] + (gameState.ball.x - centerLineX) * 0.1; 
                        targetY = basePos[1] + (gameState.ball.y - CENTER_Y) * 0.1;
                    } else {
                        targetX = (myTeam === 'home') ? centerLineX + 20 : centerLineX - 20;
                        targetY = CENTER_Y;
                    }
                    if (distToBall < AI_DEFAULT_CHASE_DISTANCE) {
                         targetX = gameState.ball.x;
                         targetY = gameState.ball.y;
                    }
                }
            
                if (myTeam === 'home') {
                    player.targetX = Math.max(centerLineX + 10, targetX); 
                } else {
                    player.targetX = Math.min(centerLineX - 10, targetX); 
                }
                player.targetY = Math.max(0, Math.min(FIELD_HEIGHT, targetY)); 
                continue; 
            }

            // サイドハーフの動き (変更なし)
            const ballOnMySide = (myTeam === 'home' && gameState.ball.x < FIELD_WIDTH / 2) || (myTeam === 'away' && gameState.ball.x > FIELD_WIDTH / 2);
            if (player.role === 'MF-L' && !ballOnMySide && distToBall > AI_DEFAULT_CHASE_DISTANCE) {
                player.targetX = FIELD_WIDTH / 2 + (myTeam === 'home' ? 50 : -50); 
                player.targetY = SIDE_Y_L - 30; 
                continue;
            }
            if (player.role === 'MF-R' && !ballOnMySide && distToBall > AI_DEFAULT_CHASE_DISTANCE) {
                player.targetX = FIELD_WIDTH / 2 + (myTeam === 'home' ? 50 : -50);
                player.targetY = SIDE_Y_R + 30; 
                continue;
            }
            
            // パスコースを作る動き (MF/DF) (変更なし)
            if (teamHasBall && basePos) {
                const nearestOpponent = findNearestOpponent(player);
                if (nearestOpponent) {
                    const angleToOpponent = Math.atan2(nearestOpponent.y - player.y, nearestOpponent.x - player.x);
                    player.targetX = player.x - Math.cos(angleToOpponent) * 50; 
                    player.targetY = player.y - Math.sin(angleToOpponent) * 50;
                } else {
                    player.targetX = basePos[0] + (myTeam === 'home' ? 30 : -30);
                    player.targetY = basePos[1];
                }
                continue; 
            }

            // ポジショニング意識 (MF/DF) (変更なし)
            if (!teamHasBall && distToBall > AI_DEFAULT_CHASE_DISTANCE && basePos) {
                player.targetX = basePos[0] + (gameState.ball.x - FIELD_WIDTH / 2) * 0.2; 
                player.targetY = basePos[1] + (gameState.ball.y - CENTER_Y) * 0.2;
                continue;
            }

            // デフォルト: ボールを追いかける (近い場合)
            player.targetX = gameState.ball.x;
            player.targetY = gameState.ball.y;
        }
    }
}


// --- 物理演算 (フェーズ1 + フェーズ4修正) ---
function updatePhysics() {
    const ball = gameState.ball;
    const GRAVITY = -0.15; // 重力加速度 (マイナス値)
    const GROUND_BOUNCE = -0.3; // 地面の反発係数

    // ★ フェーズ1 (2): Z軸（高さ）の計算
    ball.z += ball.vz;
    
    if (ball.z > 0) {
        ball.vz += GRAVITY; // 重力の影響 (マイナス値を加算)
    } else {
        // 地面に着地
        ball.z = 0;
        if (ball.vz < -1) { // 一定以上の速度で着地したらバウンド
             ball.vz *= GROUND_BOUNCE;
        } else {
             ball.vz = 0;
        }
    }

    ball.x += ball.vx;
    ball.y += ball.vy;
    ball.vx *= BALL_DRAG;
    ball.vy *= BALL_DRAG;
    if (ball.y < 0) { ball.y = 0; ball.vy *= -1; }
    if (ball.y > FIELD_HEIGHT) { ball.y = FIELD_HEIGHT; ball.vy *= -1; }

    // ★★★ フェーズ4 (要求1): ゴールの高さ制限 ★★★
    const isGoalHome = ball.x > GOAL_LINE_X_AWAY && ball.y > GOAL_POST_Y_TOP && ball.y < GOAL_POST_Y_BOTTOM && ball.z < GOAL_HEIGHT;
    const isGoalAway = ball.x < GOAL_LINE_X_HOME && ball.y > GOAL_POST_Y_TOP && ball.y < GOAL_POST_Y_BOTTOM && ball.z < GOAL_HEIGHT;

    if (isGoalHome || isGoalAway) {
        if (isGoalHome) {
            gameState.score.home++;
            kickOffTeam = 'away'; 
        } else {
            gameState.score.away++;
            kickOffTeam = 'home'; 
        }
        if (lastScorer) {
            gameState.scorers.push({ playerId: lastScorer, time: gameState.time });
        }
        io.emit('game_message', { 
            type: 'GOAL', 
            team: isGoalHome ? 'home' : 'away',
            score: gameState.score,
            scorerId: lastScorer
        });
        resetBallAndPlayers();
        return; 
    }
    if (ball.x < 0) { ball.x = 0; ball.vx *= -1; }
    if (ball.x > FIELD_WIDTH) { ball.x = FIELD_WIDTH; ball.vx *= -1; }

    // プレイヤーの移動 (変更なし)
    for (const id in gameState.players) {
        const player = gameState.players[id];
        const angle = Math.atan2(player.targetY - player.y, player.targetX - player.x);
        const playerSpeed = (player.stats.speed / 100) * PLAYER_SPEED; 
        const dist = Math.hypot(player.targetX - player.x, player.targetY - player.y);
        if (dist > playerSpeed) {
            player.vx = Math.cos(angle) * playerSpeed;
            player.vy = Math.sin(angle) * playerSpeed;
            player.x += player.vx;
            player.y += player.vy;
        } else {
            player.x = player.targetX;
            player.y = player.targetY;
            player.vx = 0;
            player.vy = 0;
        }
    }

    // ドリブル (ボールとプレイヤーの衝突)
    if (closestPlayerToBall && gameState.players[closestPlayerToBall].isBallHolder) {
        // (フェーズ4: 高さ制限により、isBallHolderがtrueになるのはz=0付近のみ)
        const player = gameState.players[closestPlayerToBall];
        const playerSpeed = Math.hypot(player.vx, player.vy);
        if (playerSpeed > 0.1) { 
            const angle = Math.atan2(player.vy, player.vx); 
            ball.x = player.x + Math.cos(angle) * 10;
            ball.y = player.y + Math.sin(angle) * 10;
            ball.vx = player.vx * BALL_SPEED_FACTOR * (player.stats.dribble / 100);
            ball.vy = player.vy * BALL_SPEED_FACTOR * (player.stats.dribble / 100);
            ball.z = 0; // ドリブル中はz=0に固定
            ball.vz = 0;
        } else {
            ball.x = player.x + 5; 
            ball.y = player.y;
            ball.vx *= BALL_DRAG; 
            ball.vy *= BALL_DRAG;
            ball.z = 0;
            ball.vz = 0;
        }
    }
}


// --- ゴール後のリセット (NaNバグ修正 + 要求2) ---
function resetBallAndPlayers(isInitialStart = false) {
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
        // ★★★ 修正 (NaNバグ): z: 0, vz: 0 をリセット時に必ず含める ★★★
         gameState.ball = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0, z: 0, vz: 0 };
    }
    const homePositions = HOME_POSITIONS;
    const awayPositions = AWAY_POSITIONS;
    for (const id in gameState.players) {
         const player = gameState.players[id];
        let pos = player.team === 'home' ? homePositions[id] : awayPositions[id];
        if (pos) { player.x = pos[0]; player.y = pos[1]; } 
        player.vx = 0; player.vy = 0; player.isBallHolder = false; player.targetX = player.x; player.targetY = player.y;
    }
    currentHolderId = null; 

    // 自動キックオフ
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
        gameState.ball.x = FIELD_WIDTH / 2;
        gameState.ball.y = CENTER_Y;
        // ★★★ 修正 (NaNバグ + 要求2): z=0, vz=0 (浮かない) に設定 ★★★
        gameState.ball.z = 0; 
        gameState.ball.vz = 0; 
        
        console.log(`[Server] Auto-kicking off. Team: ${kickOffTeam}`);
        if (kickOffTeam === 'home') {
            kickOffPlayerId = 'player6';
            gameState.ball.vx = 48 * GLOBAL_SPEED_FACTOR; // v3.3
        } else {
            kickOffPlayerId = 'player14';
            gameState.ball.vx = -48 * GLOBAL_SPEED_FACTOR; // v3.3
        }
        gameState.ball.vy = (Math.random() - 0.5) * 24 * GLOBAL_SPEED_FACTOR; // v3.3
        isPaused = false; 
    }
}


// --- Socket.IO接続ハンドリング、サーバー起動 (変更なし) ---
io.on('connection', (socket) => {
    console.log("[Server] Client connected:", socket.id);
    
     socket.on('disconnect', () => {
        console.log("[Server] Client disconnected:", socket.id);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`[Server] Server listening on http://localhost:${PORT}`);
    startGameLoop();
});

// エラーハンドリング (変更なし)
process.on('uncaughtException', (err) => {
    console.error('[Server Error] Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[Server Error] Unhandled Rejection at:', promise, 'reason:', reason);
});