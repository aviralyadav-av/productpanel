import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { can, requirePermission } from "@/lib/auth/guards";
import { ATTRIBUTE_FILTER_TYPE_META, ATTRIBUTE_INPUT_TYPE_META, type AttributeFilterType, type AttributeInputType } from "@/lib/enums";
import { PageHeader } from "@/components/shared/page-header";
import { Panel } from "@/components/shared/panel";
import { StatusPill } from "@/components/shared/status-badge";

import { AttributeForm } from "@/features/attributes/components/attribute-form";
import { AttributeUsagePanel } from "@/features/attributes/components/attribute-usage-panel";
import { AttributeValuesPanel } from "@/features/attributes/components/attribute-values-panel";
import { hasValueList, isAttributeInputType } from "@/features/attributes/compat";
import { getAttributeDetail } from "@/features/attributes/queries";

export const metadata: Metadata = { title: "Attribute" };

/** /admin/attributes/[id]: definition form, values panel (select types) and usage. */
export default async function AttributeEditPage({ params }: PageProps<"/admin/attributes/[id]">) {
  const actor = await requirePermission("attributes.view");
  const { id } = await params;
  const detail = await getAttributeDetail(id);
  if (!detail) notFound();
  const { attribute, values, usage } = detail;
  const canManage = can(actor, "attributes.manage");
  const inputType = isAttributeInputType(attribute.inputType) ? attribute.inputType : null;
  const showValues = inputType ? hasValueList(inputType) : false;

  return (
    <div className="space-y-4">
      <PageHeader
        title={attribute.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono">{attribute.code}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{ATTRIBUTE_INPUT_TYPE_META[attribute.inputType as AttributeInputType]?.label ?? attribute.inputType}</span>
            <span className="text-muted-foreground/60">·</span>
            <span>{ATTRIBUTE_FILTER_TYPE_META[attribute.filterType as AttributeFilterType]?.label ?? attribute.filterType}</span>
            {attribute.unit ? (
              <>
                <span className="text-muted-foreground/60">·</span>
                <span>unit {attribute.unit}</span>
              </>
            ) : null}
          </span>
        }
        actions={
          <>
            {attribute.isGlobal ? <StatusPill label="Global" tone="brand" /> : null}
            {attribute.isVariantDefining ? <StatusPill label="Variant-defining" tone="info" /> : null}
            <StatusPill label={attribute.isActive ? "Active" : "Inactive"} tone={attribute.isActive ? "success" : "warning"} />
          </>
        }
      />

      {/* grid-cols-1 gives the single column a minmax(0,1fr) track; an
          implicit `auto` track sizes to the widest child (the values table)
          and pushed the page to 900px on a tablet. */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          <AttributeForm mode="edit" attribute={attribute} usage={usage} canManage={canManage} />
          {showValues ? (
            <Panel
              title={`Values (${values.length})`}
              description={inputType === "COLOR" ? "Each value carries a swatch colour shown in the filter." : "The options shoppers pick from; the token is the public filter value."}
              bodyClassName="pb-2"
            >
              <AttributeValuesPanel attributeId={attribute.id} isColor={inputType === "COLOR"} values={values} canManage={canManage} />
            </Panel>
          ) : null}
        </div>
        <Panel title="Usage" description="Where this attribute is referenced." className="xl:sticky xl:top-4 xl:self-start">
          <AttributeUsagePanel code={attribute.code} usage={usage} />
        </Panel>
      </div>
    </div>
  );
}
