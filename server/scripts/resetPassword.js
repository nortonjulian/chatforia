import bcrypt from 'bcrypt';
import prisma from '../utils/prismaClient.js';

async function main() {
  const [, , ident, newPass] = process.argv;

  if (!ident || !newPass) {
    console.error(
      'Usage: node scripts/resetPassword.js <username-or-email> <newpass>'
    );
    process.exit(1);
    return; // important for tests: stop executing after exit
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: ident, mode: 'insensitive' } },
        { username: { equals: ident, mode: 'insensitive' } },
      ],
    },
    select: { id: true, username: true, email: true },
  });

  if (!user) {
    console.error('No user found for:', ident);
    process.exit(1);
    return; // stop after exit
  }

  const hash = await bcrypt.hash(newPass, 10);

  // Your schema sometimes uses `password` and sometimes `passwordHash`.
  // Write to both safely; one will stick depending on your migration history.
  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { password: null, passwordHash: hash },
    });
  } catch {
    await prisma.user.update({
      where: { id: user.id },
      data: { password: hash },
    });
  }

  console.log(
    'Password reset OK for user id',
    user.id,
    'username',
    user.username
  );
  process.exit(0);
}

// Run the script immediately when imported/executed
main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Example usage:
// node scripts/resetPassword.js jtn "YourNewPass123!"
