import { SelectInput } from '../../components/ui/select-input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table';
import type { BillingCatalogResponse, CompanyFeatureEntitlement, FeatureInclusion } from './billing-types';

const LABELS: Record<FeatureInclusion, string> = {
  no: 'No',
  yes: 'Yes',
  basic: 'Basic',
  full: 'Full',
  limited: 'Limited',
  add_on: 'Add-on',
  included_fair_use: 'Included fair use',
  discounted_add_on: 'Discounted add-on',
  custom: 'Custom',
  assisted_migration: 'Assisted migration',
};

const EDITABLE_VALUES: FeatureInclusion[] = [
  'no',
  'yes',
  'basic',
  'full',
  'limited',
  'add_on',
  'included_fair_use',
  'discounted_add_on',
  'custom',
  'assisted_migration',
];

type FeatureMatrixTableProps = {
  catalog: BillingCatalogResponse;
  editableFeatures?: CompanyFeatureEntitlement[];
  onChange?: (features: CompanyFeatureEntitlement[]) => void;
};

export function FeatureMatrixTable({ catalog, editableFeatures, onChange }: FeatureMatrixTableProps) {
  const editable = Array.isArray(editableFeatures) && typeof onChange === 'function';

  function patch(featureCode: string, inclusion: FeatureInclusion) {
    if (!editableFeatures || !onChange) return;

    onChange(
      editableFeatures.map((feature) =>
        feature.feature_code === featureCode ? { ...feature, inclusion, enabled: inclusion !== 'no' } : feature,
      ),
    );
  }

  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="min-w-56">Feature</TableHead>
            {editable ? (
              <TableHead>Client Setting</TableHead>
            ) : (
              catalog.tiers.map((tier) => <TableHead key={tier.code}>{tier.name}</TableHead>)
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {catalog.features.map((feature) => {
            const current = editableFeatures?.find((row) => row.feature_code === feature.code);

            return (
              <TableRow key={feature.code}>
                <TableCell>
                  <div className="font-medium">{feature.name}</div>
                  <div className="text-xs text-muted-foreground">{feature.category}</div>
                </TableCell>
                {editable ? (
                  <TableCell>
                    <SelectInput
                      value={current?.inclusion || 'no'}
                      aria-label={`${feature.name} entitlement`}
                      onChange={(event) => patch(feature.code, event.target.value as FeatureInclusion)}
                    >
                      {EDITABLE_VALUES.map((value) => (
                        <option key={value} value={value}>
                          {LABELS[value]}
                        </option>
                      ))}
                    </SelectInput>
                  </TableCell>
                ) : (
                  catalog.tiers.map((tier) => {
                    const matrix = catalog.featureMatrix.find(
                      (row) => row.tier_code === tier.code && row.feature_code === feature.code,
                    );

                    return <TableCell key={tier.code}>{LABELS[(matrix?.inclusion || 'no') as FeatureInclusion]}</TableCell>;
                  })
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
