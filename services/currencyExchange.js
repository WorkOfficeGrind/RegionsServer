const axios = require("axios");
const logger = require("../utils/logger");
const CustomError = require("../utils/customError");

// Cache object to store rates with USD as base
const rateCache = {
  rates: {},
  timestamp: null,
  expiryTime: 3600000, // 1 hour in milliseconds
};

// Hardcoded cryptocurrency rates as fallback
// These will be used if the API doesn't provide crypto rates
const cryptoRates = {
  BTC: 63849.5, // BTC to USD rate
  ETH: 3409.75, // ETH to USD rate
  XRP: 0.53, // XRP to USD rate
  LTC: 70.65, // LTC to USD rate
  DOGE: 0.097, // DOGE to USD rate
  USDT: 1.0, // USDT to USD rate
  USDC: 1.0, // USDC to USD rate
};

/**
 * Refresh and re-base exchange rates to USD as the base currency.
 */
const refreshRateCache = async () => {
  try {
    // Try to fetch rates from the primary API
    const response = await axios.get(
      process.env.EXCHANGE_RATE_API_URL ||
        "https://api.exchangerate-api.com/v4/latest/EUR",
      {
        timeout: 5000,
        headers: {
          Accept: "application/json",
          "User-Agent": "YourAppName/1.0.0",
        },
      }
    );

    if (response.data && response.data.rates) {
      const eurRates = response.data.rates;
      const usdRate = eurRates["USD"];

      if (!usdRate) {
        throw new CustomError(
          500,
          "USD rate is not available in the fetched rates"
        );
      }

      // Re-base the rates so that USD is the base currency
      const usdBaseRates = {};
      for (const currency in eurRates) {
        usdBaseRates[currency] = eurRates[currency] / usdRate;
      }
      usdBaseRates["USD"] = 1; // explicitly set USD as 1

      // Try to fetch cryptocurrency rates from a secondary API
      try {
        // This would typically be a different API that provides crypto rates
        // For this example, we're just using the hardcoded fallback values

        // Uncomment and update if you have a real crypto API:
        // const cryptoResponse = await axios.get(
        //   process.env.CRYPTO_RATE_API_URL || "https://api.example.com/crypto/rates",
        //   { timeout: 5000 }
        // );
        // const cryptoData = cryptoResponse.data;

        // Instead, we'll use our hardcoded values:
        for (const crypto in cryptoRates) {
          // For each crypto, 1 CRYPTO = X USD
          // So rate is 1/X for USD to CRYPTO
          usdBaseRates[crypto] = 1 / cryptoRates[crypto];
        }

        logger.info("Cryptocurrency rates added to the exchange rate cache");
      } catch (cryptoError) {
        // If crypto API fails, still use hardcoded fallback values
        logger.warn(
          "Failed to fetch cryptocurrency rates, using fallback values",
          {
            error: cryptoError.message,
          }
        );

        for (const crypto in cryptoRates) {
          usdBaseRates[crypto] = 1 / cryptoRates[crypto];
        }
      }

      rateCache.rates = usdBaseRates;
      rateCache.timestamp = Date.now();
      logger.info("Exchange rates updated and re-based to USD successfully", {
        availableCurrencies: Object.keys(usdBaseRates).length,
        includesCrypto: Object.keys(usdBaseRates).some((curr) =>
          Object.keys(cryptoRates).includes(curr)
        ),
      });
    } else {
      throw new CustomError(
        500,
        "Invalid response format while fetching exchange rates"
      );
    }
  } catch (error) {
    logger.error("Failed to update exchange rates:", {
      error: error.message,
      stack: error.stack,
    });

    // If we have no rates at all, at least set up the crypto rates
    if (!rateCache.rates || Object.keys(rateCache.rates).length === 0) {
      const emergencyRates = { USD: 1 };

      for (const crypto in cryptoRates) {
        emergencyRates[crypto] = 1 / cryptoRates[crypto];
      }

      rateCache.rates = emergencyRates;
      rateCache.timestamp = Date.now();
      logger.warn("Using emergency fallback rates due to API failure");
    }
  }
};

/**
 * @desc    Get all cached exchange rates
 * @route   GET /api/wallets/rates
 * @access  Private
 */
exports.getRates = async (req, res, next) => {
  try {
    // This assumes you have a cache of rates in your service
    const now = Date.now();
    if (
      !rateCache.timestamp ||
      now - rateCache.timestamp > rateCache.expiryTime
    ) {
      await refreshRateCache();
    }

    const { rates } = rateCache;

    logger.debug("Available rates in cache", {
      availableCurrencies: Object.keys(rates),
      timestamp: new Date(rateCache.timestamp).toISOString(),
    });

    // const rates = currencyExchange.getRateCache();

    res.status(200).json({
      success: true,
      rates,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error getting exchange rate:", {
      fromCurrency,
      toCurrency,
      rates: rateCache.rates ? Object.keys(rateCache.rates) : "no rates",
      timestamp: rateCache.timestamp
        ? new Date(rateCache.timestamp).toISOString()
        : "no timestamp",
      error: error.message,
    });
    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError(500, "Failed to get exchange rate");
  }
};

/**
 * Get the exchange rate from source currency to target currency
 * using rates re-based to USD.
 *
 * @param {String} fromCurrency Source currency code (e.g., 'USD')
 * @param {String} toCurrency Target currency code (e.g., 'EUR')
 * @returns {Number} Exchange rate from source to target currency
 */
exports.getExchangeRate = async (fromCurrency, toCurrency) => {
  try {
    // Return 1 if converting to the same currency
    if (fromCurrency === toCurrency) {
      return 1;
    }

    // Log the request for debugging
    logger.debug("Exchange rate requested", {
      fromCurrency,
      toCurrency,
      cacheAge: rateCache.timestamp
        ? (Date.now() - rateCache.timestamp) / 1000 + " seconds"
        : "no cache",
    });

    // Check if cache needs refresh
    const now = Date.now();
    if (
      !rateCache.timestamp ||
      now - rateCache.timestamp > rateCache.expiryTime
    ) {
      await refreshRateCache();
    }

    const { rates } = rateCache;

    // Log available rates for debugging
    logger.debug("Available rates in cache", {
      availableCurrencies: Object.keys(rates),
      timestamp: new Date(rateCache.timestamp).toISOString(),
    });

    if (!rates || Object.keys(rates).length === 0) {
      throw new CustomError(500, "Exchange rates currently unavailable");
    }

    // Check if both currencies are available in our rates
    if (!rates[fromCurrency]) {
      throw new CustomError(
        400,
        `Currency ${fromCurrency} is not supported for conversion`
      );
    }

    if (!rates[toCurrency]) {
      throw new CustomError(
        400,
        `Currency ${toCurrency} is not supported for conversion`
      );
    }

    // With USD as base, conversion is simple:
    // Conversion rate from source to target = rates[target] / rates[source]
    const rate = rates[toCurrency] / rates[fromCurrency];

    // Conversion from crypto to USD (inverse of USD to crypto)
    // If fromCurrency is BTC and toCurrency is USD:
    // rates[BTC] gives us the USD/BTC rate (how many BTC per 1 USD)
    // So BTC/USD rate = 1 / rates[BTC]

    if (isNaN(rate) || rate === 0) {
      logger.error("Invalid rate calculation", {
        fromCurrency,
        toCurrency,
        fromRate: rates[fromCurrency],
        toRate: rates[toCurrency],
        calculatedRate: rate,
      });
      throw new CustomError(
        400,
        `Could not determine exchange rate from ${fromCurrency} to ${toCurrency}`
      );
    }

    logger.debug("Exchange rate determined", {
      fromCurrency,
      toCurrency,
      rate,
    });

    return rate;
  } catch (error) {
    logger.error("Error getting exchange rate:", {
      fromCurrency,
      toCurrency,
      rates: rateCache.rates ? Object.keys(rateCache.rates) : "no rates",
      timestamp: rateCache.timestamp
        ? new Date(rateCache.timestamp).toISOString()
        : "no timestamp",
      error: error.message,
    });
    if (error instanceof CustomError) {
      throw error;
    }
    throw new CustomError(500, "Failed to get exchange rate");
  }
};

/**
 * Convert an amount from one currency to another
 *
 * @param {Number|String} amount Amount to convert
 * @param {String} fromCurrency Source currency code
 * @param {String} toCurrency Target currency code
 * @returns {Number} Converted amount
 */
exports.convertAmount = async (amount, fromCurrency, toCurrency) => {
  try {
    logger.debug("Converting amount", {
      amount,
      fromCurrency,
      toCurrency,
    });

    const rate = await exports.getExchangeRate(fromCurrency, toCurrency);
    const convertedAmount = parseFloat(amount) * rate;

    logger.debug("Amount converted", {
      originalAmount: amount,
      convertedAmount,
      rate,
      fromCurrency,
      toCurrency,
    });

    return convertedAmount;
  } catch (error) {
    logger.error("Error converting amount:", {
      amount,
      fromCurrency,
      toCurrency,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Get list of supported currencies
 *
 * @returns {Array} Array of supported currency codes
 */
exports.getSupportedCurrencies = () => {
  if (!rateCache.rates || Object.keys(rateCache.rates).length === 0) {
    return Object.keys(cryptoRates).concat(["USD"]);
  }
  return Object.keys(rateCache.rates);
};

// Initialize cache on module load
refreshRateCache().catch((err) => {
  logger.error("Initial exchange rate cache population failed:", {
    error: err.message,
  });
});

// Export the full module for easier testing
module.exports = exports;
