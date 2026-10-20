// Local server:  npm run dev  ->  http://localhost:3000/api/health
// Reads .env if present. No Paystack key = mock mode.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

const envPath = join(__dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Imported after .env is loaded so modules see the variables.
import('./app').then(({ default: app }) => {
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => {
    console.log(`Brightfield fees API on http://localhost:${port}`);
    console.log(`Payments mode: ${process.env.PAYSTACK_SECRET_KEY && process.env.MOCK_PAYSTACK !== 'true' ? 'Paystack test' : 'MOCK'}`);
    console.log(`Auth: ${process.env.TOOL_API_KEY ? 'required (x-api-key)' : 'disabled'}`);
  });
});
