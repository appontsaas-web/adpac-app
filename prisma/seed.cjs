// Creates the first admin user so you can sign in.
// Usage: npm run db:seed
// Override defaults with env vars: SEED_EMAIL, SEED_PASSWORD, SEED_NAME

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL || 'admin@adpac.ai';
  const password = process.env.SEED_PASSWORD || 'changeme123';
  const name = process.env.SEED_NAME || 'AdPac Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists — skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { email, passwordHash, name, role: 'ADMIN' },
  });

  console.log(`Created admin user:`);
  console.log(`  email:    ${email}`);
  console.log(`  password: ${password}`);
  console.log(`Change this password after your first login.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
