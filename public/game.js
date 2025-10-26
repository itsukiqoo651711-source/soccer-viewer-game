// public/game.js (最終修正版 - 起動保証)
const socket = io();

// --- DOM要素の参照 ---
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


// Phaser設定
const config = {
    type: Phaser.AUTO, width: 800, height: 600, parent: 'game-container', 
    physics: { default: 'arcade', arcade: { debug: false }},
    scene: { preload: preload, create: create, update: update },
    transparent: true
};
const game = new Phaser.Game(config);

let players = {}; 
let ball;
let field;

// --- 補助関数 ---
function getPlayerStatsToShow(role) {
    if (role.startsWith('F')) return ['shot', 'speed']; 
    if (role.startsWith('M')) return ['pass', 'dribble']; 
    if (role.startsWith('D')) return ['tackle', 'speed']; 
    if (role === 'GK') return ['tackle', 'pass']; 
    return ['speed', 'tackle'];
}
function statKeyToName(key) {
    if (key === 'shot') return 'シュート';
    if (key === 'speed') return 'スピード';
    if (key === 'pass') return 'パス';
    if (key === 'dribble') return 'ドリブル';
    if (key === 'tackle') return 'タックル';
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


// --- Phaser Preload ---
function preload() {
    this.load.image('field', 'assets/field.png'); 
    this.load.image('player_home.png', 'assets/player_home.png'); 
    this.load.image('player_away.png', 'assets/player_away.png'); 
    this.load.image('ball', 'assets/ball.png'); 
    
    this.load.image('keeper_home.png', 'assets/keeper_home.png');
    this.load.image('keeper_away.png', 'assets/keeper_away.png');
    
    this.load.image('Sakuraba_home.png', 'assets/Sakuraba_home.png');
    this.load.image('Gouda_home.png', 'assets/Gouda_home.png');
    
    this.load.image('Zoro_away.png', 'assets/Zoro_away.png');
    this.load.image('Itoshi_away.png', 'assets/Itoshi_away.png'); 
}

// --- Phaser Create ---
function create() {
    field = this.add.image(config.width / 2, config.height / 2, 'field');
    field.setDisplaySize(config.width, config.height); 
    field.setDepth(-1);

    ball = this.add.sprite(0, 0, 'ball');
    ball.setOrigin(0.5, 0.5); 
    ball.setScale(0.12);

    // ★Socket.IOメッセージ受信: GOAL!表示とキックオフ待機
    socket.on('game_message', (data) => {
        if (data.type === 'GOAL') {
            const teamName = data.team === 'Home' ? 'ホーム' : 'アウェイ';
            gameMessageOverlay.innerHTML = `<div class="goal-text">GOAL!</div>${teamName} ${data.score.home}-${data.score.away}<br><span class="kickoff-text">タップでキックオフ！</span>`;
            gameMessageOverlay.style.display = 'block';
            gameMessageOverlay.classList.add('goal-flash');
            setTimeout(() => gameMessageOverlay.classList.remove('goal-flash'), 100);
        } else if (data.type === 'KICKOFF_WAIT') {
            const teamName = data.team === 'home' ? 'ホーム (青)' : 'アウェイ (赤)';
            gameMessageOverlay.innerHTML = `<span class="kickoff-text">キックオフ！ ${data.score.home}-${data.score.away}<br>ボール保持：${teamName}</span>`;
            gameMessageOverlay.style.display = 'block';
        } else if (data.type === 'START') {
            gameMessageOverlay.style.display = 'none';
        }
    });

    socket.on('game_state_update', (gameState) => {
        // UIが未構築なら構築
        if (homePlayerListElement.children.length === 0 && Object.keys(gameState.players).length > 0) {
            updateChapterPanelPlayers(gameState.players);
        }
        updateChapterPanelScorers(gameState.scorers, gameState.players); // players情報を渡す
        
        // ライブステータス更新用の選手を特定
        let homeClosestPlayer = null;
        let awayClosestPlayer = null;
        let minHomeDist = Infinity;
        let minAwayDist = Infinity;
        
        for (const id in gameState.players) {
            const serverPlayer = gameState.players[id];
            
            // ライブステータス更新
            if (players[id]) {
                const distToBall = Phaser.Math.Distance.Between(serverPlayer.x, serverPlayer.y, gameState.ball.x, gameState.ball.y);
                if (serverPlayer.team === 'home') {
                    if (distToBall < minHomeDist) { minHomeDist = distToBall; homeClosestPlayer = serverPlayer; }
                } else {
                    if (distToBall < minAwayDist) { minAwayDist = distToBall; awayClosestPlayer = serverPlayer; }
                }
            }
            
            // ★描画処理
            let clientPlayer = players[id];
            if (!clientPlayer) {
                 const rawKey = serverPlayer.imageKey; 
                 let finalImageKey;
                 if (rawKey.includes('.png')) { finalImageKey = rawKey; } else { finalImageKey = rawKey + '.png'; }
                 if (!this.textures.exists(finalImageKey)) { 
                     // console.error(`Missing image key: ${finalImageKey}`); 
                     continue; 
                 }

                 clientPlayer = this.add.sprite(serverPlayer.x, serverPlayer.y, finalImageKey);
                 clientPlayer.setOrigin(0.5, 0.9); 
                 players[id] = clientPlayer;
                 clientPlayer.setScale(0.14); 

                 clientPlayer.nameText = this.add.text(serverPlayer.x, serverPlayer.y - 20, `${serverPlayer.displayName.startsWith('player') ? serverPlayer.id.replace('player', 'P') : serverPlayer.displayName.substring(0, 3)}`, {
                     font: '12px Arial', fill: '#fff', stroke: '#000', strokeThickness: 2
                 }).setOrigin(0.5);
            }
            clientPlayer.x = Phaser.Math.Linear(clientPlayer.x, serverPlayer.x, 0.2);
            clientPlayer.y = Phaser.Math.Linear(clientPlayer.y, serverPlayer.y, 0.2);
            clientPlayer.setDepth(clientPlayer.y);
            clientPlayer.nameText.setDepth(clientPlayer.y); 
            clientPlayer.nameText.setPosition(clientPlayer.x, clientPlayer.y - clientPlayer.displayHeight / 2 - 5);
        }
        
        ball.x = Phaser.Math.Linear(ball.x, gameState.ball.x, 0.2);
        ball.y = Phaser.Math.Linear(ball.y, gameState.ball.y, 0.2);
        ball.setDepth(ball.y); 

        // ★ライブステータスパネルの更新
        updateLiveStatus(homeClosestPlayer, homeLiveName, homeLiveStat1, homeLiveStat2, 'home');
        updateLiveStatus(awayClosestPlayer, awayLiveName, awayLiveStat1, awayLiveStat2, 'away');

        // スコアとタイマーの更新
        homeScoreElement.textContent = gameState.score.home;
        awayScoreElement.textContent = gameState.score.away;
        const minutes = Math.floor(gameState.time / 60);
        const seconds = gameState.time % 60;
        gameTimerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    });
}

function update() { /* ... */ }

// --- チャプターパネル更新関数 ---

function createPlayerListItem(player) {
    const item = document.createElement('div');
    item.className = 'player-list-item';
    
    // ★修正点：名前表示
    const displayName = player.displayName.startsWith('player') ? player.id.replace('player', 'P') : player.displayName;

    const nameRole = document.createElement('span');
    nameRole.textContent = `${displayName} / ${player.role.replace('-', ' ')}`;
    item.appendChild(nameRole);

    // 能力ランク
    const ranksContainer = document.createElement('div');
    ranksContainer.className = 'player-ranks';
    
    // ★修正点：略語を略さず表示するため、ランクはCSSで制御
    ranksContainer.innerHTML = `
        <span class="${getRankClass(player.ranks.spd)}">${player.ranks.spd}</span>
        <span class="${getRankClass(player.ranks.sht)}">${player.ranks.sht}</span>
        <span class="${getRankClass(player.ranks.pas)}">${player.ranks.pas}</span>
        <span class="${getRankClass(player.ranks.drb)}">${player.ranks.drb}</span>
        <span class="${getRankClass(player.ranks.tck)}">${player.ranks.tck}</span>
    `;
    item.appendChild(ranksContainer);
    return item;
}

function updateChapterPanelPlayers(players) {
    homePlayerListElement.innerHTML = '';
    awayPlayerListElement.innerHTML = '';
    
    const sortedPlayers = Object.values(players).sort((a, b) => parseInt(a.id.replace('player', '')) - parseInt(b.id.replace('player', '')));

    sortedPlayers.forEach(player => {
        const item = createPlayerListItem(player);
        if (player.team === 'home') {
            homePlayerListElement.appendChild(item);
        } else {
            awayPlayerListElement.appendChild(item);
        }
    });
}

function updateChapterPanelScorers(scorers, allPlayers) {
    if (scorerListElement.children.length === scorers.length) return;

    scorerListElement.innerHTML = '';
    if (scorers.length === 0) {
        scorerListElement.textContent = 'まだ得点はありません';
        return;
    }

    scorers.forEach(scorer => {
        const item = document.createElement('div');
        item.className = 'scorer-item';
        const teamName = scorer.team === 'Home' ? '青' : '赤';
        
        // ★修正点：得点者名の表示
        let displayName;
        if (allPlayers[scorer.id]) {
            displayName = allPlayers[scorer.id].displayName.startsWith('player') ? scorer.id.replace('player', 'P') : allPlayers[scorer.id].displayName;
        } else {
            displayName = scorer.id.replace('player', 'P');
        }

        item.textContent = `(${scorer.time}) [${teamName}] ${displayName}`;
        scorerListElement.appendChild(item);
    });
}

function updateLiveStatus(player, nameDiv, stat1Div, stat2Div, team) {
    if (!player) {
        if (team === 'home') homeLiveStatusPanel.style.display = 'none';
        if (team === 'away') awayLiveStatusPanel.style.display = 'none';
        return;
    }

    const statsKeys = getPlayerStatsToShow(player.role);
    const stat1Key = statsKeys[0];
    const stat2Key = statsKeys[1];
    
    // 固有名があれば表示、なければID
    const displayName = player.displayName.startsWith('player') ? player.id.replace('player', 'P') : player.displayName;

    nameDiv.innerHTML = `${displayName}`;

    // Stat 1, Stat 2: 略さずに表示
    const stat1Rank = player.ranks[stat1Key.substring(0, 3)];
    const stat2Rank = player.ranks[stat2Key.substring(0, 3)];
    
    stat1Div.innerHTML = `${statKeyToName(stat1Key)}:<span class="${getRankClass(stat1Rank)} live-status-value">${stat1Rank}</span>`;
    stat2Div.innerHTML = `${statKeyToName(stat2Key)}:<span class="${getRankClass(stat2Rank)} live-status-value">${stat2Rank}</span>`;
    
    if (team === 'home') homeLiveStatusPanel.style.display = 'block';
    if (team === 'away') awayLiveStatusPanel.style.display = 'block';
}