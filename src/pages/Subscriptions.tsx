import { SubscriptionTable } from '../components/SubscriptionTable';
import { PageHeader } from '../components/ui';

export default function Subscriptions() {
  return (
    <>
      <PageHeader title="Subscriptions" description="Every subscription and where it stands, from draft to closed." />
      <SubscriptionTable />
    </>
  );
}
