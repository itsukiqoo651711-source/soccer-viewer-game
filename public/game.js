// public/game.js (v3.5 - フェーズ2: 影と高さの描画)
const socket = io();

// --- DOM要素の参照 (変更なし) ---
const homeScoreElement = document.getElementById('home-score');
const awayScoreElement = document.getElementById('away-score');
const gameTimerElement = document.getElementById('game-timer');
const gameMessageOverlay = document.getElementById('game-message-overlay');

const homePlayerListElement = document.getElementById('home-player-list');
const awayPlayerListElement = document.getElementById('away-player-list');
const scorerListElement = document.getElementById('scorer-list');

const homeLiveName = document.getElementById('home-live-name');
const homeLiveStat1 = document.getElementById('home-live-stat1');
const homeLiveStat2 = document.getElementById('home-live-stat2');
const awayLiveName = document.getElementById('away-live-name');
const awayLiveStat1 = document.getElementById('away-live-stat1');
const awayLiveStat2 = document.getElementById('away-live-stat2');
const homeLiveStatusPanel = document.getElementById('home-live-status');
const awayLiveStatusPanel = document.getElementById('away-live-status');


// Phaser設定 (変更なし)
const config = {
    type: Phaser.AUTO, width: 800, height: 600, parent: 'game-container',
    physics: { default: 'arcade', arcade: { debug: false }},
    scene: { preload: preload, create: create, update: update },
    transparent: true
};
const game = new Phaser.Game(config);

let players = {};
let ball;
let ballShadow; // ★ フェーズ2 (1): 影用の変数を追加
let field;
let serverPlayersData = {}; 

// --- 補助関数 (変更なし) ---
function getPlayerStatsToShow(role) {
    if (!role) return ['spd', 'tck'];
    if (role.startsWith('F')) return ['sht', 'spd'];
    if (role.startsWith('M')) return ['pas', 'drb'];
    if (role.startsWith('D')) return ['tck', 'spd'];
    if (role === 'GK') return ['tck', 'pas'];
    return ['spd', 'tck'];
}
function statKeyToName(key) {
    if (key === 'sht') return 'シュート';
    if (key === 'spd') return 'スピード';
    if (key === 'pas') return 'パス';
    if (key === 'drb') return 'ドリブル';
    if (key === 'tck') return 'タックル';
    return key;
}
function getRankClass(rank) {
    if (rank === 'S') return 'rank-S';
    if (rank === 'A') return 'rank-A';
    if (rank === 'B') return 'rank-B';
    if (rank === 'C') return 'rank-C';
    if (rank === 'D') return 'rank-D';
    return 'rank-E';
}


// --- Phaser Preload (フェーズ2修正) ---
function preload() {
    console.log("Preloading assets...");
    this.load.image('field', 'assets/field.png');
    this.load.image('player_home', 'assets/player_home.png');
    this.load.image('player_away', 'assets/player_away.png');
    this.load.image('ball', 'assets/ball.png');
    // ★ フェーズ2 (2): ball_shadow.png を読み込む (事前に/public/assets/に配置してください)
    this.load.image('ball_shadow', 'assets/ball_shadow.png'); 

    this.load.image('keeper_home', 'assets/keeper_home.png');
    this.load.image('keeper_away', 'assets/keeper_away.png');

    this.load.image('Sakuraba_home', 'assets/Sakuraba_home.png');
    this.load.image('Gouda_home', 'assets/Gouda_home.png');

    this.load.image('Zoro_away', 'assets/Zoro_away.png');
    this.load.image('Itoshi_away', 'assets/Itoshi_away.png');
    console.log("Asset preloading complete.");
}

// --- Phaser Create (フェーズ2修正) ---
function create() {
    console.log("Phaser create function started.");
    field = this.add.image(config.width / 2, config.height / 2, 'field');
    field.setDisplaySize(config.width, config.height);
    field.setDepth(-1);

    // ★ フェーズ2 (3): 影スプライトを先に生成
    ballShadow = this.add.sprite(400, 300, 'ball_shadow');
    ballShadow.setOrigin(0.5, 0.5);
    ballShadow.setScale(0.1); // ボールより少し小さく
    ballShadow.setAlpha(0.3); // 半透明に
    ballShadow.setVisible(false);
    // ★ 修正ここまで

    ball = this.add.sprite(400, 300, 'ball');
    ball.setOrigin(0.5, 0.5);
    ball.setScale(0.12);
    ball.setVisible(false);

    socket.on('connect', () => { console.log('Socket connected successfully!'); });
    socket.on('disconnect', () => { console.log('Socket disconnected.'); });

    socket.on('game_message', (data) => {
        console.log("Received game_message:", data);
        const scoreHome = (data.score && typeof data.score.home !== 'undefined') ? data.score.home : 0;
        const scoreAway = (data.score && typeof data.score.away !== 'undefined') ? data.score.away : 0;

        if (data.type === 'GOAL') {
            const teamName = data.team === 'home' ? 'ホーム' : 'アウェイ'; 
            gameMessageOverlay.innerHTML = `<div class="goal-text">GOAL!</div>${teamName} ${scoreHome}-${scoreAway}`;
            gameMessageOverlay.style.display = 'block';
            setTimeout(() => {
                gameMessageOverlay.style.display = 'none';
            }, 2000); 
        }
    });

    socket.on('game_state_update', (gameState) => {
        if (!gameState || !gameState.players || !gameState.ball || !gameState.score || typeof gameState.time === 'undefined') {
            console.warn("Incomplete gameState received, skipping update:", gameState);
            return; 
        }

        serverPlayersData = gameState.players; 
        if (homePlayerListElement.children.length === 0 && Object.keys(gameState.players).length > 0) {
            updateChapterPanelPlayers(gameState.players);
        }
        updateChapterPanelScorers(gameState.scorers, gameState.players);

        let homeClosestPlayer = null;
        let awayClosestPlayer = null;
        let minHomeDist = Infinity;
        let minAwayDist = Infinity;

        // プレイヤーの生成と更新
        for (const id in gameState.players) {
            const serverPlayer = gameState.players[id];
            let clientPlayer = players[id];

            const distToBall = Phaser.Math.Distance.Between(serverPlayer.x, serverPlayer.y, gameState.ball.x, gameState.ball.y);
            if (serverPlayer.team === 'home') {
                if (distToBall < minHomeDist) { minHomeDist = distToBall; homeClosestPlayer = serverPlayer; }
            } else {
                if (distToBall < minAwayDist) { minAwayDist = distToBall; awayClosestPlayer = serverPlayer; }
            }

            if (!clientPlayer) {
                 const finalImageKey = serverPlayer.imageKey;

                 if (!finalImageKey || !this.textures.exists(finalImageKey)) {
                     console.error(`Missing image key: ${finalImageKey} for player ${serverPlayer.id}`);
                     continue; 
                 }

                 clientPlayer = this.add.sprite(serverPlayer.x, serverPlayer.y, finalImageKey);
                 clientPlayer.setOrigin(0.5, 0.9);
                 players[id] = clientPlayer;
                 
                 // (v3.3) 選手の大きさ 0.9倍
                 clientPlayer.setScale(0.126); 
            }
            // 描画位置の補間
            clientPlayer.x = Phaser.Math.Linear(clientPlayer.x, serverPlayer.x, 0.2);
            clientPlayer.y = Phaser.Math.Linear(clientPlayer.y, serverPlayer.y, 0.2);
            clientPlayer.setDepth(clientPlayer.y);
            
            // (v3.4) 選手名テキストは非表示

        } // End of player loop

        // ★★★ ここから修正 (フェーズ2 (4)) ★★★
        // ボールの表示と更新
        if (gameState.ball) {
            if (!ball.visible) {
                ball.setVisible(true);
                ballShadow.setVisible(true); // 影も表示
            }
            
            const ballX = gameState.ball.x;
            const ballY = gameState.ball.y;
            // ★★★ NaNガードを追加 ★★★
            // サーバーから NaN が送られてきても 0 として扱う
            const ballZ = (!isNaN(gameState.ball.z) ? gameState.ball.z : 0);

            // (1) 影の位置は (x, y)
            ballShadow.x = Phaser.Math.Linear(ballShadow.x, ballX, 0.2);
            ballShadow.y = Phaser.Math.Linear(ballShadow.y, ballY, 0.2);
            ballShadow.setDepth(ballShadow.y); // 影は地面のY座標で深度決定

            // (2) ボール本体の位置は (x, y - z)
            ball.x = Phaser.Math.Linear(ball.x, ballX, 0.2);
            ball.y = Phaser.Math.Linear(ball.y, ballY - ballZ, 0.2); // ← Zの高さを引く
            ball.setDepth(ball.y); // 本体は浮いたY座標で深度決定

            // (3) 高さに応じてスケールと透明度を変更（オプション）
            const shadowScale = Math.max(0.05, 0.1 - (ballZ / 100)); // 高いほど影が小さく
            const shadowAlpha = Math.max(0.1, 0.3 - (ballZ / 100)); // 高いほど影が薄く
            ballShadow.setScale(shadowScale);
            ballShadow.setAlpha(shadowAlpha);

            const ballScale = 0.12 + (ballZ / 1000); // 高いほどボールが大きく（手前に）
            ball.setScale(ballScale);

        } else {
             ball.setVisible(false);
             ballShadow.setVisible(false); // 影も非表示
        }
        // ★★★ 修正ここまで ★★★
        
        // ライブステータスの更新
        updateLiveStatus(homeClosestPlayer, homeLiveName, homeLiveStat1, homeLiveStat2, 'home');
        updateLiveStatus(awayClosestPlayer, awayLiveName, awayLiveStat1, awayLiveStat2, 'away');

        // スコアとタイマーの更新
        homeScoreElement.textContent = gameState.score.home;
        awayScoreElement.textContent = gameState.score.away;
        const minutes = Math.floor(gameState.time / 60).toString().padStart(2, '0');
        const seconds = (gameState.time % 60).toString().padStart(2, '0');
        gameTimerElement.textContent = `${minutes}:${seconds}`;
    });
    console.log("Phaser create function finished.");
}

// --- Phaser Update (クライアント側) (変更なし) ---
function update() { 
    /* サーバー側でロジックを実行するため空 */
}

// --- UI更新関数 (変更なし) ---

/**
 * チャプターパネルの選手リスト項目DOMを生成
 */
function createPlayerListItem(player) {
    const item = document.createElement('div');
    item.className = 'player-list-item';
    item.id = `chapter-${player.id}`; 

    const nameDiv = document.createElement('span');
    const displayName = player.displayName.startsWith('player') ? player.id.replace('player', 'P') : player.displayName;
    nameDiv.textContent = `${displayName} (${player.role || 'N/A'})`;
    nameDiv.style.width = '100px'; 
    nameDiv.style.overflow = 'hidden';
    nameDiv.style.textOverflow = 'ellipsis';
    nameDiv.style.whiteSpace = 'nowrap';

    const ranksDiv = document.createElement('div');
    ranksDiv.className = 'player-ranks';

    const ranks = player.ranks || {}; 
    const rankKeys = ['spd', 'sht', 'pas', 'drb', 'tck'];

    rankKeys.forEach(key => {
        const rankSpan = document.createElement('span');
        const rankValue = ranks[key] || 'E'; 
        rankSpan.textContent = rankValue;
        rankSpan.className = getRankClass(rankValue); 
        ranksDiv.appendChild(rankSpan);
    });

    item.appendChild(nameDiv);
    item.appendChild(ranksDiv);
    return item;
}

/**
* チャプターパネルの全選手リストを更新 (初回生成のみ)
*/
function updateChapterPanelPlayers(playersData) {
    if (homePlayerListElement.children.length > 0 || awayPlayerListElement.children.length > 0) {
        return;
    }
    console.log("Initializing Chapter Panel Player List...");

    const sortedPlayers = Object.values(playersData).sort((a, b) => {
        const idA = parseInt(a.id.replace('player', ''), 10);
        const idB = parseInt(b.id.replace('player', ''), 10);
        return idA - idB;
    });

    sortedPlayers.forEach(player => {
        if (!player || !player.id) return; 

        const listItem = createPlayerListItem(player);
        if (player.team === 'home') {
            homePlayerListElement.appendChild(listItem);
        } else {
            awayPlayerListElement.appendChild(listItem);
        }
    });
}

/**
 * 得点者リストを更新
 */
let lastScorerCount = 0; 
function updateChapterPanelScorers(scorers, allPlayersData) {
    const validScorers = scorers || [];

    if (lastScorerCount === validScorers.length) {
        return;
    }
    lastScorerCount = validScorers.length; 

    scorerListElement.innerHTML = ''; 
    if (validScorers.length === 0) {
        scorerListElement.innerHTML = '<div class="scorer-item">まだ得点はありません</div>';
        return;
    }

    validScorers.forEach(scorer => {
        if (!scorer) return; 
        const player = allPlayersData[scorer.playerId];
        const displayName = player ? (player.displayName.startsWith('player') ? player.id : player.displayName) : '不明';
        const teamName = player ? (player.team === 'home' ? '(ホーム)' : '(アウェイ)') : '';
        
        const item = document.createElement('div');
        item.className = 'scorer-item';
        const minutes = Math.floor(scorer.time / 60).toString().padStart(2, '0');
        const seconds = (scorer.time % 60).toString().padStart(2, '0');

        item.textContent = `[${minutes}:${seconds}] ${displayName} ${teamName}`;
        scorerListElement.appendChild(item);
    });
}


/**
 * ライブステータスパネルを更新
 */
function updateLiveStatus(player, nameDiv, stat1Div, stat2Div, team) {
    const panel = (team === 'home') ? homeLiveStatusPanel : awayLiveStatusPanel;

    if (!player || !player.id || !player.ranks) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = 'block';

    const displayName = player.displayName.startsWith('player') ? player.id.replace('player', 'P') : player.displayName;
    nameDiv.innerHTML = `[${player.role || 'N/A'}] <span class="live-status-value">${displayName}</span>`;

    const statKeys = getPlayerStatsToShow(player.role); 
    const ranks = player.ranks;

    const key1 = statKeys[0]; 
    const rank1 = ranks[key1] || 'E'; 
    stat1Div.innerHTML = `${statKeyToName(key1)}: <span class="live-status-value ${getRankClass(rank1)}">${rank1}</span>`;

    const key2 = statKeys[1]; 
    const rank2 = ranks[key2] || 'E'; 
    stat2Div.innerHTML = `${statKeyToName(key2)}: <span class="live-status-value ${getRankClass(rank2)}">${rank2}</span>`;
}