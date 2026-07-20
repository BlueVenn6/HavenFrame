import { useEffect } from "react";

import { useBoardStore } from "../stores/useBoardStore";
import type { AssetRecord } from "../types";
import { useLocale } from "../i18n/locale";

const roomTypes = [
  { id: "living-room", zh: "客厅", en: "Living room" },
  { id: "dining-room", zh: "餐厅", en: "Dining room" },
  { id: "bedroom", zh: "卧室", en: "Bedroom" },
  { id: "kitchen", zh: "厨房", en: "Kitchen" },
  { id: "bathroom", zh: "卫生间", en: "Bathroom" },
  { id: "home-office", zh: "书房", en: "Study" },
  { id: "entryway", zh: "玄关", en: "Entryway" },
  { id: "lobby", zh: "大堂", en: "Lobby" },
  { id: "lounge", zh: "休闲区", en: "Lounge" },
  { id: "meeting-room", zh: "会议室", en: "Meeting room" },
];

export function RoomTagger({ assets }: { assets: AssetRecord[] }) {
  const { text } = useLocale();
  const selectedRoomIds = useBoardStore((state) => state.selectedRoomIds);
  const setSelectedRoomIds = useBoardStore((state) => state.setSelectedRoomIds);
  const roomIds = assets.map((_, index) => selectedRoomIds[index] ?? roomTypes[index]?.id ?? "living-room");

  useEffect(() => {
    if (roomIds.join("|") !== selectedRoomIds.join("|")) setSelectedRoomIds(roomIds);
  }, [roomIds, selectedRoomIds, setSelectedRoomIds]);

  const updateRoom = (index: number, roomId: string) => {
    const next = [...roomIds];
    next[index] = roomId;
    setSelectedRoomIds(next);
  };

  return (
    <div className="panel-surface p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">{text("房间标记", "Room labels")}</div>
          <h3 className="section-title mt-2">{text("每张图片对应一个房间", "Assign one room to each image")}</h3>
        </div>
        <span className="status-pill">{text(`${assets.length} 张图片 / ${roomIds.length} 个房间`, `${assets.length} images / ${roomIds.length} rooms`)}</span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {assets.length === 0 ? (
          <div className="panel-muted p-4 text-sm font-medium text-studio-mutedText lg:col-span-2">{text("上传房间图片后再设置对应房间。", "Upload room images before assigning rooms.")}</div>
        ) : assets.map((asset, index) => (
          <label key={asset.id} className="block rounded-lg border border-studio-border bg-studio-panelBg p-3">
            <span className="block truncate text-xs font-semibold text-studio-mutedText">{text(`图片 ${index + 1}`, `Image ${index + 1}`)} · {asset.file_name}</span>
            <select value={roomIds[index]} onChange={(event) => updateRoom(index, event.target.value)} className="form-field mt-2 w-full">
              {roomTypes.map((room) => <option key={room.id} value={room.id}>{text(room.zh, room.en)}</option>)}
            </select>
          </label>
        ))}
      </div>
    </div>
  );
}
