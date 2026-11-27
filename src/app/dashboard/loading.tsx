import Image from "next/image";

export default function DashboardLoading() {
  return (
    <main className="eba-dashboard-loading" role="status" aria-live="polite">
      <div className="eba-dashboard-loading__robot" aria-hidden="true">
        <Image src="/images/eba-assistant-robot.png" alt="" width={352} height={352} priority />
        <span className="eba-dashboard-loading__eyelid eba-dashboard-loading__eyelid--left" />
        <span className="eba-dashboard-loading__eyelid eba-dashboard-loading__eyelid--right" />
        <span className="eba-dashboard-loading__thought"><i /><i /><i /></span>
      </div>
      <p>Loading EBA Hub…</p>
    </main>
  );
}
