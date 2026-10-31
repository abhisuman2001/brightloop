import type { SellerInfo } from '../../shared/types';

/** The business issuing the invoices. The defaults are the fictional demo company. */
export const sellerInfo = (): SellerInfo => ({
  name: process.env.COMPANY_NAME ?? 'Brightloop Software',
  address: process.env.COMPANY_ADDRESS ?? 'Bengaluru, Karnataka',
  gstin: process.env.COMPANY_GSTIN ?? '29AABCB1234C1Z5',
  upiId: process.env.UPI_ID ?? '',
});
