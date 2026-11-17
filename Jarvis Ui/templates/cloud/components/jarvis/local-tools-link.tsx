"use client";

import { WrenchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

export function LocalToolsLink() {
  const [isKorean, setIsKorean] = useState(false);

  useEffect(() => setIsKorean(navigator.language.startsWith("ko")), []);

  return (
    <Link className="jarvis-toolbar-link" href="/tools">
      <WrenchIcon size={16} aria-hidden="true" />
      {isKorean ? "로컬 도구" : "Local tools"}
    </Link>
  );
}
