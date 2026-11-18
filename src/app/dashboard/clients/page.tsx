import { ClientsWorkspace, type Query } from "./client-workspace";

export default function Clients({ searchParams }: { searchParams: Promise<Query> }) {
  return <ClientsWorkspace searchParams={searchParams} />;
}
