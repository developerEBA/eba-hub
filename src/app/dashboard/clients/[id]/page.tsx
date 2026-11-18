import { notFound } from "next/navigation";
import { Suspense } from "react";
import DashboardLoading from "../../loading";
import { ClientsWorkspace, type Query } from "../client-workspace";
import { isClientId } from "../directory";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Query> };

async function SelectedClient({ params, searchParams }: Props) {
  const { id } = await params;
  if (id !== "new" && !isClientId(id)) notFound();
  return <ClientsWorkspace id={id} searchParams={searchParams} />;
}

export default function ClientPage(props: Props) {
  return <Suspense fallback={<DashboardLoading />}><SelectedClient {...props} /></Suspense>;
}
