import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <SignIn signUpUrl="/sign-up" />
    </div>
  );
}
