console.log('Curler Tracker Initialized');

// Add event listeners for button interactions
document.getElementById('playerForm').addEventListener('submit', function(event) {
    event.preventDefault();
    let playerName = document.getElementById('playerInput').value;
    document.getElementById('trackedPlayer').textContent = playerName;
    document.getElementById('statusLine').textContent = 'Tracking ' + playerName;
});
