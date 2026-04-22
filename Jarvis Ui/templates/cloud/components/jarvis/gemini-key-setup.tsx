"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CheckIcon, KeyIcon } from "lucide-react";

export const GeminiKeySetup = () => {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    if (!key.trim()) return;
    setLoading(true);
    try {
      // @ts-ignore
      await window.electron.invoke("assistant:save-gemini-key", { key: key.trim() });
      setSaved(true);
    } catch (err) {
      console.error("Failed to save Gemini key:", err);
    } finally {
      setLoading(false);
    }
  };

  if (saved) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-400">
        <CheckIcon className="size-4" />
        <span>Gemini API 키가 성공적으로 저장되었습니다! 이제 초고속 모드를 사용할 수 있습니다.</span>
      </div>
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <KeyIcon className="size-4" />
        <span>Gemini API 키 설정</span>
      </div>
      <div className="flex gap-2">
        <Input
          type="password"
          placeholder="AI Studio에서 발급받은 키를 입력하세요"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          className="h-9 flex-1 bg-background/50 text-xs"
        />
        <Button 
          size="sm" 
          onClick={handleSave} 
          disabled={loading || !key.trim()}
          className="h-9 px-4"
        >
          {loading ? "저장 중..." : "저장"}
        </Button>
      </div>
    </div>
  );
};
