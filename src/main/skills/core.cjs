module.exports = [
  {
    name: "done",
    aliases: [],
    inputKeys: ["summary"],
    schema: '{"action":"done","summary":"..."}',
    description: "작업 완료 및 요약 제공",
    execute: async () => {
      return { state: null, error: null };
    }
  }
];
