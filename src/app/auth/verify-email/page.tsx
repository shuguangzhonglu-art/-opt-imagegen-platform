import { verifyEmailAction } from "@/lib/actions/auth-actions";

type VerifyEmailPageProps = {
  searchParams?: Promise<{
    token?: string;
  }>;
};

export default async function VerifyEmailPage({ searchParams }: VerifyEmailPageProps) {
  const params = (await searchParams) ?? {};
  await verifyEmailAction(params.token ?? "");
}
