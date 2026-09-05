"use client";

import * as React from "react";
import { CircleHelp, Loader2, Plus, SquarePen, Trash2, X } from "lucide-react";

import {
  DataTable,
  DataTableBody,
  DataTableHead,
  TableCaptionRow,
  Td,
  Th,
  Tr,
} from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { FilterTabs, SearchInput } from "@/components/shared/list-controls";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import {
  createFaq,
  deleteFaq,
  reorderFaqs,
  toggleFaq,
  updateFaq,
} from "../actions";
import type { FaqRow } from "../queries";
import { MoveButtons, moveInList, useActionToast } from "./section-editor";

const COLUMNS = 6;

/**
 * The FAQ list. Editing happens inline rather than in a sheet: a question and
 * an answer are two fields, and an operator fixing a typo should not have to
 * open a drawer to do it.
 */
export function FaqTab({
  faqs,
  groups,
  total,
  filtered,
}: {
  faqs: FaqRow[];
  groups: Array<{ value: string; label: string; count: number }>;
  total: number;
  filtered: boolean;
}) {
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [creating, setCreating] = React.useState(false);
  const { pending, run } = useActionToast();

  function move(index: number, direction: -1 | 1) {
    const ids = faqs.map((faq) => faq.id);
    const next = moveInList(ids, index, index + direction);
    if (next === ids) return;
    run(() => reorderFaqs({ ids: next }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <SearchInput placeholder="Search questions…" className="w-56" />
        {groups.length > 1 ? (
          <FilterTabs paramKey="group" options={groups} allLabel="All groups" />
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <span data-numeric className="text-muted-foreground text-[11px]">
            {total} question{total === 1 ? "" : "s"}
          </span>
          <Button
            type="button"
            size="xs"
            disabled={pending || creating}
            onClick={() => {
              setEditingId(null);
              setCreating(true);
            }}
          >
            <Plus />
            Add question
          </Button>
        </div>
      </div>

      {filtered ? (
        <p className="text-muted-foreground border-b px-4 py-1.5 text-[11px]">
          Reordering is switched off while a search or group filter is active —
          positions are global, not per filter.
        </p>
      ) : null}

      {faqs.length === 0 && !creating ? (
        <EmptyState
          icon={CircleHelp}
          title={filtered ? "No questions match" : "No questions yet"}
          description={
            filtered
              ? "Clear the search or the group filter to see the rest."
              : "The six seeded questions come from the storefront's FAQ page. Add another with the button above."
          }
        />
      ) : (
        <DataTable>
          <DataTableHead>
            <Th width="40px" align="right">
              #
            </Th>
            <Th>Question</Th>
            <Th width="140px">Group</Th>
            <Th width="80px" align="center">
              Order
            </Th>
            <Th width="70px" align="center">
              Shown
            </Th>
            <Th width="90px" />
          </DataTableHead>

          <DataTableBody>
            {creating ? (
              <TableCaptionRow colSpan={COLUMNS}>
                <FaqForm
                  heading="New question"
                  groups={groups.map((group) => group.value)}
                  onCancel={() => setCreating(false)}
                  onSubmit={(values) => createFaq(values)}
                  onSaved={() => setCreating(false)}
                />
              </TableCaptionRow>
            ) : null}

            {faqs.map((faq, index) =>
              editingId === faq.id ? (
                <TableCaptionRow key={faq.id} colSpan={COLUMNS}>
                  <FaqForm
                    heading="Edit question"
                    groups={groups.map((group) => group.value)}
                    initial={faq}
                    onCancel={() => setEditingId(null)}
                    onSubmit={(values) =>
                      updateFaq({ ...values, id: faq.id })
                    }
                    onSaved={() => setEditingId(null)}
                  />
                </TableCaptionRow>
              ) : (
                <Tr key={faq.id}>
                  <Td numeric align="right" className="text-muted-foreground">
                    {index + 1}
                  </Td>
                  <Td className="max-w-[520px]">
                    <p className="truncate font-medium">{faq.question}</p>
                    <p className="text-muted-foreground truncate text-[11px]">
                      {faq.answer}
                    </p>
                  </Td>
                  <Td className="text-muted-foreground">{faq.group}</Td>
                  <Td align="center">
                    <div className="flex justify-center">
                      <MoveButtons
                        label={`question ${index + 1}`}
                        disabled={pending || filtered}
                        canMoveUp={index > 0}
                        canMoveDown={index < faqs.length - 1}
                        onUp={() => move(index, -1)}
                        onDown={() => move(index, 1)}
                      />
                    </div>
                  </Td>
                  <Td align="center">
                    <Switch
                      size="sm"
                      checked={faq.enabled}
                      disabled={pending}
                      aria-label={`Show "${faq.question}"`}
                      onCheckedChange={(checked) =>
                        run(() => toggleFaq({ id: faq.id, enabled: checked }))
                      }
                    />
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={pending}
                        aria-label={`Edit "${faq.question}"`}
                        onClick={() => {
                          setCreating(false);
                          setEditingId(faq.id);
                        }}
                      >
                        <SquarePen />
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            disabled={pending}
                            aria-label={`Delete "${faq.question}"`}
                          >
                            <Trash2 className="text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>
                              Delete this question?
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              &ldquo;{faq.question}&rdquo; will be removed from
                              the FAQ page. This cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => run(() => deleteFaq({ id: faq.id }))}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </Td>
                </Tr>
              ),
            )}
          </DataTableBody>
        </DataTable>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

type FaqValues = { question: string; answer: string; group: string };

function FaqForm({
  heading,
  initial,
  groups,
  onSubmit,
  onCancel,
  onSaved,
}: {
  heading: string;
  initial?: FaqRow;
  groups: string[];
  onSubmit: (values: FaqValues) => Promise<ActionResult<{ id: string }>>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [question, setQuestion] = React.useState(initial?.question ?? "");
  const [answer, setAnswer] = React.useState(initial?.answer ?? "");
  const [group, setGroup] = React.useState(initial?.group ?? "General");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const { pending, run } = useActionToast();

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setErrors({});
    run(async () => {
      const result = await onSubmit({ question, answer, group });
      if (!result.ok && result.fieldErrors) setErrors(result.fieldErrors);
      if (result.ok) onSaved();
      return result;
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-muted/40 space-y-3 border-y px-4 py-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold">{heading}</h3>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={onCancel}
          aria-label="Cancel"
        >
          <X />
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <div className="space-y-1.5">
          <Label htmlFor="faq-question" className="text-xs">
            Question
          </Label>
          <Input
            id="faq-question"
            value={question}
            disabled={pending}
            autoFocus
            aria-invalid={errors.question ? true : undefined}
            onChange={(event) => setQuestion(event.target.value)}
            className="h-8 text-xs"
          />
          {errors.question ? (
            <p className="text-destructive text-[11px]">{errors.question}</p>
          ) : null}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="faq-group" className="text-xs">
            Group
          </Label>
          <Input
            id="faq-group"
            list="faq-groups"
            value={group}
            disabled={pending}
            aria-invalid={errors.group ? true : undefined}
            onChange={(event) => setGroup(event.target.value)}
            className="h-8 text-xs"
          />
          <datalist id="faq-groups">
            {groups.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {errors.group ? (
            <p className="text-destructive text-[11px]">{errors.group}</p>
          ) : null}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="faq-answer" className="text-xs">
          Answer
        </Label>
        <Textarea
          id="faq-answer"
          rows={3}
          value={answer}
          disabled={pending}
          aria-invalid={errors.answer ? true : undefined}
          onChange={(event) => setAnswer(event.target.value)}
          className="text-xs"
        />
        {errors.answer ? (
          <p className="text-destructive text-[11px]">{errors.answer}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={pending}
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="xs" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}
