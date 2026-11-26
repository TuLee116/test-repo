"use client";

export default function QuantityCell({
  defaultValue,
  action,
}: {
  defaultValue: number;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="flex justify-end">
      <input
        name="quantity"
        type="number"
        step="any"
        min="0"
        defaultValue={defaultValue}
        className="w-24 rounded-md border border-slate-300 px-2 py-1 text-right text-sm"
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      />
    </form>
  );
}
