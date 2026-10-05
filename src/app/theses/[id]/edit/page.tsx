import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getThesis } from "@/lib/queries/thesis";
import { isEditable } from "@/lib/thesis";
import { updateThesisAction } from "../../actions";
import { ThesisForm } from "@/components/thesis/ThesisForm";
import { KindChip, StatusBadge } from "@/components/thesis/ui";

export const dynamic = "force-dynamic";

export default async function EditThesisPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getThesis(id);
  if (!t) notFound();
  if (!isEditable(t.status)) redirect(`/theses/${id}`);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <nav aria-label="Breadcrumb" className="text-xs text-zinc-500 dark:text-zinc-400">
          <Link href="/theses" className="hover:underline">Investment theses</Link> / <Link href={`/theses/${id}`} className="hover:underline">{t.title}</Link>
        </nav>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-zinc-950 dark:text-white">Edit thesis</h1>
      </header>
      <ThesisForm
        mode="edit"
        action={updateThesisAction.bind(null, id)}
        initial={t}
        cancelHref={`/theses/${id}`}
        lockedSubject={
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm dark:border-zinc-700 dark:bg-zinc-800/50">
            <KindChip kind={t.subjectKind} />
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.subject.label}</span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{t.subject.sublabel}</span>
            <StatusBadge status={t.status} />
            <span className="text-xs text-zinc-500 dark:text-zinc-400">The subject and status are changed separately — to change the subject, write a new thesis.</span>
          </div>
        }
      />
    </div>
  );
}
