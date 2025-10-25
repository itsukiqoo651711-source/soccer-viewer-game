// public/game.js (全文)
const socket = io();

// UI要素のDOM参照
const homeScoreElement = document.getElementById('home-score');
const awayScoreElement = document.getElementById('away-score');
const gameTimerElement = document.getElementById('game-timer');
const playerStatusPanel = document.getElementById('player-status-panel');
const statusNameElement = document.getElementById('status-name');
const statusOffenseElement = document.getElementById('status-offense');
const statusPowerElement = document.getElementById('status-power');
const statusSpeedElement = document.getElementById('status-speed');
const gameOverMessageElement = document.getElementById('game-over-message');


// Phaser設定
const config = {
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    parent: 'game-container', 
    physics: {
        default: 'arcade',
        arcade: {
            debug: false 
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    },
    transparent: true
};

const game = new Phaser.Game(config);

let players = {}; 
let ball;
let field;

function preload() {
    this.load.image('field', 'assets/field.png'); 
    this.load.image('player_home', 'assets/player_home.png'); 
    this.load.image('player_away', 'assets/player_away.png'); 
    this.load.image('ball', 'assets/ball.png'); 
}

function create() {
    field = this.add.image(config.width / 2, config.height / 2, 'field');
    field.setDisplaySize(config.width, config.height); 
    field.setDepth(-1);

    ball = this.add.sprite(0, 0, 'ball');
    ball.setOrigin(0.5, 0.5); 
    ball.setScale(0.12); // ボールのスケール

    socket.on('game_state_update', (gameState) => {
        for (const id in gameState.players) {
            const serverPlayer = gameState.players[id];
            let clientPlayer = players[id];

            if (!clientPlayer) {
                const playerImageKey = serverPlayer.team === 'home' ? 'player_home' : 'player_away';
                clientPlayer = this.add.sprite(serverPlayer.x, serverPlayer.y, playerImageKey);
                clientPlayer.setOrigin(0.5, 0.9); 
                players[id] = clientPlayer;

                clientPlayer.nameText = this.add.text(serverPlayer.x, serverPlayer.y - 20, `${serverPlayer.id.replace('player', 'P')}`, {
                    font: '12px Arial',
                    fill: '#fff',
                    stroke: '#000',
                    strokeThickness: 2
                }).setOrigin(0.5);
            }

            clientPlayer.x = Phaser.Math.Linear(clientPlayer.x, serverPlayer.x, 0.2);
            clientPlayer.y = Phaser.Math.Linear(clientPlayer.y, serverPlayer.y, 0.2);

            clientPlayer.setDepth(clientPlayer.y);
            clientPlayer.nameText.setDepth(clientPlayer.y); 
            clientPlayer.nameText.setPosition(clientPlayer.x, clientPlayer.y - clientPlayer.displayHeight / 2 - 5);

            const minScale = 0.15; 
            const maxScale = 0.25; 
            const scaleFactor = minScale + (maxScale - minScale) * (clientPlayer.y / config.height);
            clientPlayer.setScale(scaleFactor);

            if (serverPlayer.isBallHolder) {
                if (playerStatusPanel.style.display === 'none') {
                    playerStatusPanel.style.display = 'block';
                }
                statusNameElement.textContent = `選手: ${serverPlayer.id} (${serverPlayer.team === 'home' ? 'ホーム' : 'アウェイ'})`;
                statusOffenseElement.textContent = `O:${serverPlayer.stats.shot}`; 
                statusPowerElement.textContent = `P:${serverPlayer.stats.pass}`;  
                statusSpeedElement.textContent = `S:${serverPlayer.stats.speed}`;
            }
        }

        ball.x = Phaser.Math.Linear(ball.x, gameState.ball.x, 0.2);
        ball.y = Phaser.Math.Linear(ball.y, gameState.ball.y, 0.2);
        ball.setDepth(ball.y); 

        const anyPlayerHasBall = Object.values(gameState.players).some(p => p.isBallHolder);
        if (!anyPlayerHasBall) {
            playerStatusPanel.style.display = 'none';
        }

        homeScoreElement.textContent = gameState.score.home;
        awayScoreElement.textContent = gameState.score.away;

        const minutes = Math.floor(gameState.time / 60);
        const seconds = gameState.time % 60;
        gameTimerElement.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    });

    socket.on('game_over', (finalScore) => {
        gameOverMessageElement.innerHTML = `試合終了！<br>ホーム ${finalScore.home} - ${finalScore.away} アウェイ`;
        gameOverMessageElement.style.display = 'block';
    });
}

function update() {
    // クライアント側では特別な更新は不要
}