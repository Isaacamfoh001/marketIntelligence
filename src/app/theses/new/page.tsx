import Link from "next/link";
import { getSubjectOptions } from "@/lib/queries/thesis";
import { createThesisAction } from "../actions";
import { ThesisForm } from "@/components/thesis/ThesisForm";
import { THESIS_PAGE_INTRO } from "@/lib/thesis";

export const dynamic = "force-dynamic";

export default async function NewThesisPage({ searchParams }: { searchParams: Promise<{ subjectType?: string; subjectId?: string }> }) {
  const q = await searchParams;
  const options = await getSubjectOptions();
  const initialKey = q.subjectType && q.subjectId ? `${q.subjectType}:${q.subjectId}` : null;
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/theses" className="hover:underline">Investment theses</Link>
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">New thesis</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{THESIS_PAGE_INTRO} Save a draft with just a subject and a belief; activating asks for the reasoning, what must be true and what would prove you wrong.</p>
      </header>
      <ThesisForm mode="new" action={createThesisAction} options={options} initialSubjectKey={initialKey} cancelHref="/theses" />
    </div>
  );
}
