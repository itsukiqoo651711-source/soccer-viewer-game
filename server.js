// server.js (キックオフフリーズ解消版)
const express = require('express');
const http = require('http'); 
const socketio = require('socket.io'); 

const app = express();
const server = http.createServer(app);
const io = socketio(server);

// --- グローバルステータス/フラグ ---
let isPaused = true;
let gameTickTimer = null;
let closestPlayerToBall = null; 
let kickOffTeam = 'home'; 
let kickOffPlayerId = 'player6'; // Home FW-L

// --- ゲーム状態の初期値 ---
let gameState = {
    players: {},
    ball: { x: 400, y: 300, vx: 0, vy: 0 },
    score: { home: 0, away: 0 },
    time: 3 * 60, 
    matchEnded: false,
    scorers: []
};

// --- ゲーム設定 ---
const FIELD_WIDTH = 800; 
const FIELD_HEIGHT = 600; 
const PLAYER_COUNT = 16; 
const GLOBAL_SPEED_FACTOR = 0.8; 
const PLAYER_SPEED = 2.5 * GLOBAL_SPEED_FACTOR; 
const BALL_DRAG = 0.98;
const CENTER_Y = FIELD_HEIGHT / 2;
const SIDE_Y_L = FIELD_HEIGHT * 0.25;
const SIDE_Y_R = FIELD_HEIGHT * 0.75; 
const BALL_SPEED_FACTOR = 0.8; 

// --- E-Sランク変換関数 (省略) ---
function toRank(value) { /* ... */ return 'E'; }

// --- プレイヤーの初期化 (16人分 - 省略) ---
for (let i = 0; i < PLAYER_COUNT; i++) {
    const playerId = `player${i}`;
    const isHome = i < 8;
    
    let imageKey = isHome ? 'player_home.png' : 'player_away.png'; 
    let role = 'FW'; 
    let speedMult = 1;
    let dribbleMult = 1;
    let shotRangeMult = 1;
    let shotMult = 1;
    let displayName = playerId; 

    // --- 特別選手の能力と画像キー設定 (省略) ---
    if (i === 0) { role = 'GK'; imageKey = 'keeper_home.png'; } 
    // ... (他の選手の設定は省略) ...

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
        // ... (他のプロパティは省略) ...
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

// --- ゲームループ（サーバー側） (省略) ---
function startGameLoop() { 
    if (gameTickTimer) clearInterval(gameTickTimer); 
    // ... (ループ本体は省略) ...
}

// --- 簡易的な「スペース」チェック関数 (省略) ---
function countOpponentsNear(x, y, team) { /* ... */ return 0; }


// --- AIロジック (キックオフ時の強制移動を削除) ---
function updateAI() {
    let minDistanceToBall = Infinity;
    closestPlayerToBall = null; 

    for (const id in gameState.players) {
        const player = gameState.players[id];
        if (player.role === 'GK') continue; 

        const dist = Math.sqrt(Math.pow(player.x - gameState.ball.x, 2) + Math.pow(player.y - gameState.ball.y, 2));
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

        const isHome = player.team === 'home';
        const targetGoalX = isHome ? FIELD_WIDTH - 50 : 50;
        const targetGoalY = CENTER_Y;
        
        let mySideY = CENTER_Y;
        if (player.role.endsWith('-L')) mySideY = SIDE_Y_L;
        if (player.role.endsWith('-R')) mySideY = SIDE_Y_R;

        // ★削除：キックオフ時の強制ドリブルロジックを削除
        // if (isPaused && player.isBallHolder) { ... }

        // --- ボール保持者 ---
        if (player.isBallHolder) {
            // ... (パス/シュート/ドリブルロジックは省略) ...
        } 
        // --- 非ボール保持者 ---
        else {
            // ... (ポジションニングロジックは省略) ...
        }
        
        // --- 共通の移動処理 (省略) ---
        const angleToTarget = Math.atan2(player.targetY - player.y, player.targetX - player.x);
        const distToTarget = Math.sqrt(Math.pow(player.targetY - player.y, 2));
        
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


// --- 物理演算 (省略) ---
function updatePhysics() {
    // ... (省略) ...
}

// --- ゴール後のリセット (普通のキックオフに修正) ---
function resetBallAndPlayers(isInitialStart = false) {
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
         gameState.ball = { x: FIELD_WIDTH / 2, y: FIELD_HEIGHT / 2, vx: 0, vy: 0 };
    }
    
    // 選手を固定のキックオフ位置に配置 (8VS8フォーメーション)
    const homePositions = { 
        'player0': [60, CENTER_Y], 'player1': [200, SIDE_Y_L], 'player2': [200, SIDE_Y_R], 
        'player3': [350, CENTER_Y], 'player4': [350, SIDE_Y_L], 'player5': [350, SIDE_Y_R], 
        'player6': [FIELD_WIDTH / 2 - 50, CENTER_Y - 50], 'player7': [FIELD_WIDTH / 2 - 50, CENTER_Y + 50]
    };
    const awayPositions = {
        'player8': [FIELD_WIDTH - 60, CENTER_Y], 'player9': [FIELD_WIDTH - 200, SIDE_Y_L], 'player10': [FIELD_WIDTH - 200, SIDE_Y_R], 
        'player11': [FIELD_WIDTH - 350, CENTER_Y], 'player12': [FIELD_WIDTH - 350, SIDE_Y_L], 'player13': [FIELD_WIDTH - 350, SIDE_Y_R], 
        'player14': [FIELD_WIDTH / 2 + 50, CENTER_Y - 50], 'player15': [FIELD_WIDTH / 2 + 50, CENTER_Y + 50]
    };

    for (const id in gameState.players) {
        const player = gameState.players[id];
        let pos = player.team === 'home' ? homePositions[id] : awayPositions[id];
        
        if (pos) { player.x = pos[0]; player.y = pos[1]; } else { player.x = Math.random() * FIELD_WIDTH; player.y = Math.random() * FIELD_HEIGHT; }
        
        player.vx = 0; player.vy = 0; player.isBallHolder = false; player.targetX = player.x; player.targetY = player.y;
    }
    
    // キックオフ (ポーズ状態でボール保持権を付与)
    if (isInitialStart || gameState.score.home > 0 || gameState.score.away > 0) {
        gameState.ball.x = FIELD_WIDTH / 2;
        gameState.ball.y = CENTER_Y;
        gameState.ball.vx = 0; 
        gameState.ball.vy = 0; 
        
        let kickOffPlayer = null;
        if (kickOffTeam === 'home') {
            kickOffPlayer = gameState.players['player6']; 
        } else {
            kickOffPlayer = gameState.players['player14']; 
        }

        if (kickOffPlayer) {
             kickOffPlayer.isBallHolder = true;
             kickOffPlayerId = kickOffPlayer.id;
        }

        for (const id in gameState.players) {
            if (id !== kickOffPlayerId) {
                gameState.players[id].isBallHolder = false;
            }
        }
    }
}


// --- Socket.IO接続ハンドリング、サーバー起動 ---
io.on('connection', (socket) => {
    socket.emit('game_message', { type: 'KICKOFF_WAIT', score: gameState.score, team: kickOffTeam }); 

    socket.on('kickoff', () => {
        if (isPaused) {
            isPaused = false;
            io.emit('game_message', { type: 'START' });
        }
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    startGameLoop(); 
});