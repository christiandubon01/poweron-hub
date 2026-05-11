export const resolveEntityName = (item: any): string => {
  return (
    item.relationship_name ||
    item.relationshipName ||
    item.account_name ||
    item.accountName ||
    item.customer_name ||
    item.customerName ||
    item.client_name ||
    item.clientName ||
    item.job_name ||
    item.jobName ||
    item.displayName ||
    item.name ||
    "Unnamed"
  );
};