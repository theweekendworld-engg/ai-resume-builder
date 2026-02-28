import { auth } from '@clerk/nextjs/server';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export default async function EditorRedirectPage() {
  const { userId } = await auth();
  if (!userId) {
    redirect('/sign-in');
  }

  const latest = await prisma.resume.findFirst({
    where: { userId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true },
  });

  if (latest) {
    redirect(`/editor/${latest.id}`);
  }

  redirect('/editor/new');
}
