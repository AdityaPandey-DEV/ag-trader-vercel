import { getDescription } from '@/lib/regimeEngine'; // redundant but needed for imports
import { loadTradingState } from '@/lib/storage';

export async function POST() {
    // 0. Hydrate state logic
    const persistedState = await loadTradingState();
    if (persistedState) {
        updateState(persistedState);
    }

    const state = getState();
    const newKillSwitch = !state.kill_switch;
    updateState({ kill_switch: newKillSwitch });
    addLog(`Kill Switch ${newKillSwitch ? 'ACTIVATED' : 'DEACTIVATED'}`);

    // Persist immediately so it survives restart
    await saveTradingState(getState());

    return NextResponse.json({ status: newKillSwitch ? "STOPPED" : "ARMED", kill_switch: newKillSwitch });
}
