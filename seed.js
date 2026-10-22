// 还没接上数据库时显示的内容。接上 Supabase 后，以数据库里的内容为准。
window.SEED = {
  trips: [
    {
      id: "seed-dazu",
      title: "一起欣赏大足石刻",
      month: "2026-08",
      place: "重庆大足",
      story: "",
      photos: [{ path: "assets/dazu-2026-08.jpg", caption: "大足" }],
    },
  ],
  shows: [],
  notes: [],
  todos: ["去日本", "玩 Slay the Spire", "恋爱小甜剧", "Puzzle Hunt", "语言学"]
    .map((title, i) => ({ id: `seed-todo-${i}`, title, done_at: null, photos: [] })),
  settings: {},
};
