import Link from "next/link";
export function SetupRequired({
  message = "Configure Supabase and apply the reviewed migrations to use this feature.",
}: {
  message?: string;
}) {
  return (
    <div className="op-setup" role="status">
      <strong>Setup required</strong>
      <p>{message}</p>
      <Link href="/login">Sign-in and setup information</Link>
    </div>
  );
}
export function EmptyRecords({
  label = "No records yet.",
}: {
  label?: string;
}) {
  return <p className="op-empty">{label}</p>;
}
