import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { t, type ButtonColor, type FormField } from "@nootion/shared";
import { api } from "../lib/api";
import { AuthCard, Button } from "../components/ui";
import { ButtonForm, localNow } from "../buttons/ButtonAction";

interface PublicForm {
  title: string;
  submitLabel: string;
  color: ButtonColor;
  fields: FormField[];
}

/** A button's form opened from its public link, by someone without an account. */
export function PublicFormPage() {
  const { token = "" } = useParams();
  const form = useQuery({ queryKey: ["public-form", token], queryFn: () => api<PublicForm>(`/forms/${token}`), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState(0);
  const [done, setDone] = useState(false);

  if (form.isLoading) return <AuthCard title="Nootion">{t("common.loading")}</AuthCard>;
  if (!form.data) {
    return (
      <AuthCard title="Nootion">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{t("publicForm.notFound")}</p>
      </AuthCard>
    );
  }

  async function submit(answers: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      await api(`/forms/${token}`, { method: "POST", body: { form: answers, now: localNow() } });
      setDone(true);
      setSent((n) => n + 1);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={form.data.title}>
      {done ? (
        <div className="space-y-4 text-center" data-form-sent>
          <p className="text-sm">{t("publicForm.thanks")}</p>
          <Button variant="ghost" onClick={() => setDone(false)}>
            {t("publicForm.again")}
          </Button>
        </div>
      ) : (
        <ButtonForm key={sent} title={form.data.title} fields={form.data.fields} busy={busy} error={error} onSubmit={submit} submitLabel={t("button.submit")} />
      )}
    </AuthCard>
  );
}
