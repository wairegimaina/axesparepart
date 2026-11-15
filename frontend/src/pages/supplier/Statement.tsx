import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Loading, PageHeader } from '@/components/common'
import { PeriodPicker, usePeriod } from '@/components/PeriodPicker'
import { Statement, type StatementData } from '@/components/Statement'
import { get } from '@/lib/api'

export default function SupplierStatement() {
  const period = usePeriod()
  const q = useQuery({ queryKey: ['supplier', 'statement', period.query], queryFn: () => get<StatementData>(`/supplier/statement/?${period.query}`), placeholderData: (p) => p })
  return (
    <>
      <PageHeader title="Earnings" description={<>You earn your price once we collect an order. <Link to="/supplier/profile?tab=info" className="underline">Payout details</Link></>} />
      <div className="mb-6"><PeriodPicker period={period} csvHref={`/api/supplier/statement/?${period.query}&export=csv`} /></div>
      {q.data ? <Statement data={q.data} orderLink={(n) => `/supplier/orders/${n}`} /> : <Loading />}
    </>
  )
}
