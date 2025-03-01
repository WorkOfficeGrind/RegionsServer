// This is a lightweight placeholder.
// In production, integrate with an external API (or cache rates) for real-time data.
async function getMarketRate(currency) {
  const rates = {
    USD: 1,
    BTC: 60000, // Example: 1 BTC = 60,000 USD
    ETH: 4000, // Example: 1 ETH = 4,000 USD
  };
  return rates[currency] || 1;
}

module.exports = { getMarketRate };
