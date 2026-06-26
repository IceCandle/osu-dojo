"use client";

import React, { useEffect, useState } from "react";

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
    setLabel(
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value)),
    );
  }, [value]);

  return <time dateTime={date.toISOString()}>{label}</time>;
}
