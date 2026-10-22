// Payment gateway adapter.
//
// Routes call `charge()` and never import a concrete provider. Swapping in a
// real gateway later means:
//
//   1. create backend/lib/providers/<name>.js exporting the same contract:
//        { name, charge({ order, method, details }) → { status, transactionId, ... } }
//   2. register it below (or via registerProvider).
//   3. set PAYMENT_PROVIDER=<name> in backend/.env.
//
// A real provider that needs a redirect can additionally return
// `{ status: 'redirect', redirectUrl }`; the payment page already understands
// that shape, so no order model changes are required.
const mockPayment = require('./providers/mockPayment');

const providers = new Map([[mockPayment.name, mockPayment]]);

function registerProvider(provider) {
  if (!provider || !provider.name || typeof provider.charge !== 'function') {
    throw new Error('A payment provider must expose a name and a charge() function');
  }
  providers.set(provider.name, provider);
}

function getProviderName() {
  return (process.env.PAYMENT_PROVIDER || 'mock').toLowerCase();
}

function getProvider(name = getProviderName()) {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `Unsupported payment provider "${name}". Available providers: ${[...providers.keys()].join(', ')}`
    );
  }
  return provider;
}

/** Charge an order through the configured provider. */
async function charge(options) {
  return getProvider().charge(options);
}

module.exports = { charge, getProvider, getProviderName, registerProvider };
