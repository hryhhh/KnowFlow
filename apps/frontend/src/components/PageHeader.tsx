export default function PageHeader({
  title,
  breadcrumb,
}: {
  title: string;
  breadcrumb?: string;
}) {
  return (
    <div className="page-header">
      <span>{title}</span>
      {breadcrumb && (
        <span className="breadcrumb">/ {breadcrumb}</span>
      )}
    </div>
  );
}
