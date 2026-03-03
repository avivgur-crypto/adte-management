"use client";

import { useMemo } from "react";
import { useFilter } from "@/app/context/FilterContext";
import {
  buildDependencyResult,
  type PairEntry,
} from "@/lib/dependency-mapping-utils";
import DependencyMappingTable from "./DependencyMappingTable";
import PartnerFlowSankey from "./PartnerFlowSankey";

type Props = {
  pairsByMonth: Record<string, PairEntry[]>;
};

export default function PartnersFiltered({ pairsByMonth }: Props) {
  const { selectedMonths } = useFilter();

  const data = useMemo(() => {
    const keys = Array.from(selectedMonths).sort();
    if (keys.length === 0) {
      return {
        rows: [],
        riskDemandPartners: [],
        fromXdash: false,
        errorMessage: "Select at least one month in the filter.",
      };
    }
    return buildDependencyResult(pairsByMonth, keys);
  }, [pairsByMonth, selectedMonths]);

  return (
    <>
      <PartnerFlowSankey data={data} />
      <DependencyMappingTable data={data} />
    </>
  );
}
