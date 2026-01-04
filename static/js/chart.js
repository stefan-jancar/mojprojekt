
document.addEventListener('DOMContentLoaded', function () {
    const ctx = document.getElementById('financeChart').getContext('2d');
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Príjmy', 'Výdavky'],
            datasets: [{
                data: [
                    parseFloat(document.getElementById('incomeValue').textContent),
                    parseFloat(document.getElementById('expenseValue').textContent)
                ],
                backgroundColor: ['#6a0dad', '#f1c40f']
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#333' }
                }
            }
        }
    });
});
