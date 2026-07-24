"use client";

import React, { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/format";

export function LocalTime({
  value,
  ssrFallback,
}: {
  value: number;
  ssrFallback: string;
}) {
  const [label, setLabel] = useState(ssrFallback);
  const date = new Date(value);

  useEffect(() => {
    setLabel(formatDateTime(value));
  }, [value]);

  return <time dateTime={date.toISOString()}>{label}</time>;
}
