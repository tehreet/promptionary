"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function leaveRoomAction(roomId: string) {
  const supabase = await createSupabaseServerClient();
  await supabase.rpc("leave_room", { p_room_id: roomId });
  redirect("/");
}
