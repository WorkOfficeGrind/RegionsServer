const fromUSDrates = {
  BTC: 1 / 84649.88, // $1 = 0.00002 BTC
  ETH: 1 / 3500, // $1 = 0.000286 ETH
  USDT: 1, // $1 = 1 USDT
  XRP: 1 / 0.75, // $1 = 1.33 XRP
  DOGE: 1 / 0.15, // $1 = 6.67 DOGE
  ADA: 1 / 2.25, // $1 = 0.44 ADA
  SOL: 1 / 180, // $1 = 0.0056 SOL
  DOT: 1 / 30, // $1 = 0.033 DOT
  EUR: 1 / 1.1, // $1 = 0.91 EUR
  GBP: 1 / 1.35, // $1 = 0.74 GBP
};

const toUSDrates = {
  BTC: 84649.88, // 1 BTC = $84649.88
  ETH: 3500, // 1 ETH = $3,500
  USDT: 1, // 1 USDT = $1
  XRP: 0.75, // 1 XRP = $0.75
  DOGE: 0.15, // 1 DOGE = $0.15
  ADA: 2.25, // 1 ADA = $2.25
  SOL: 180, // 1 SOL = $180
  DOT: 30, // 1 DOT = $30
  EUR: 1.1, // 1 EUR = $1.10
  GBP: 1.35, // 1 GBP = $1.35
};

module.exports = {
  fromUSDrates,
  toUSDrates,
};
