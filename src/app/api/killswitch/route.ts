import { NextResponse } from 'next/server';
import { getState, updateState, addLog } from '@/lib/state';
import { saveTradingState } from '@/lib/storage';

export async function POST() {
    const state = getState();
    const newKillSwitch = !state.kill_switch;
    updateState({ kill_switch: newKillSwitch });
    addLog(`Kill Switch ${newKillSwitch ? 'ACTIVATED' : 'DEACTIVATED'}`);

    // Persist immediately so it survives restart
    await saveTradingState(getState());

    return NextResponse.json({ status: newKillSwitch ? "STOPPED" : "ARMED", kill_switch: newKillSwitch });
}
