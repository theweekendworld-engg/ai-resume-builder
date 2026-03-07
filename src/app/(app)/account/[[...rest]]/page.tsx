import { UserProfile } from '@clerk/nextjs';

export default function AccountPage() {
  return (
    <div className="flex min-h-screen items-start justify-center px-4 py-8">
      <UserProfile path="/account" routing="path" />
    </div>
  );
}

