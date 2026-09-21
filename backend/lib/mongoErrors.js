// Turns low-level MongoDB driver errors into actionable hints, so that a wrong
// password or a missing Atlas IP allow-list entry is obvious instead of a
// 200-line stack trace.

/** Remove the password from a connection string before printing/logging it. */
function redactUri(uri = '') {
  return String(uri).replace(/^(mongodb(?:\+srv)?:\/\/[^:@/]+):[^@]*@/, '$1:********@');
}

/** Where are we connecting to? Never includes the password. */
function connectionTarget(uri = '') {
  const stripped = redactUri(uri);
  const fromCredentials = stripped.match(/@([^/?]+)/);
  const fromPlain = stripped.match(/^mongodb:\/\/([^/?]+)/);
  const isLocal = /^mongodb:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(uri);

  return {
    uri: stripped,
    host: (fromCredentials?.[1] || fromPlain?.[1] || 'unknown').replace(/\/$/, ''),
    cloud: !isLocal,
  };
}

/** Atlas/common-connection hints for a failed connection attempt. */
function connectionHints(error, { cloud = false } = {}) {
  const raw = `${error?.code || ''} ${error?.message || error}`;
  const hints = [];

  if (/bad auth|authentication failed|scram|authenticationfailed/i.test(raw)) {
    hints.push(
      `${cloud ? 'The cloud cluster rejected' : 'MONGODB_URI was rejected for'} this ` +
        'username/password. Re-check the database user, and URL-encode special characters ' +
        'in the password (@ → %40, # → %23, / → %2F, : → %3A, ? → %3F, % → %25).'
    );
  }
  if (/enotfound|eai_again|querysrv|eservfail|getaddrinfo|dns/i.test(raw)) {
    hints.push(
      'The cluster hostname did not resolve. Copy the host exactly from ' +
        'Atlas → Connect → Drivers (e.g. cluster0.xxxxx.mongodb.net) and keep the mongodb+srv:// prefix.'
    );
  }
  if (/could not connect to any servers|server selection|etimedout|econnrefused|timed out/i.test(raw)) {
    hints.push(
      cloud
        ? 'No server answered. In Atlas → Network Access add your current IP address ' +
            '(or 0.0.0.0/0 while developing), make sure the cluster is not paused, and check your firewall/VPN.'
        : 'Nothing answered on that address. Start MongoDB locally ' +
            '(brew services start mongodb-community / sudo systemctl start mongod), or put your ' +
            'cloud connection string (mongodb+srv://…) into MONGODB_URI.'
    );
  }
  if (/ssl|tls|certificate|self.signed/i.test(raw)) {
    hints.push('TLS handshake failed — keep TLS enabled and remove any local proxy/CA override.');
  }
  if (!hints.length) {
    hints.push('Run `npm run db:check` to test the connection string on its own, and see backend/.env.example.');
  }

  return hints;
}

/** Multi-line, human-friendly description of a failed connection. */
function formatConnectionError(error, uri = '') {
  const target = connectionTarget(uri);
  const lines = [
    `Could not connect to MongoDB at ${target.host}${target.cloud ? ' (cloud)' : ' (local)'}`,
    `Reason: ${error?.message || error}`,
    'Hints:',
    ...connectionHints(error, { cloud: target.cloud }).map((hint, i) => `  ${i + 1}. ${hint}`),
  ];
  return lines.join('\n');
}

module.exports = { redactUri, connectionTarget, connectionHints, formatConnectionError };
