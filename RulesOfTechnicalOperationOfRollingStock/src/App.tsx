import { useState, useEffect, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import standsData, { Stand, Light, Mode } from './data/standsData';
import { parseMetaFile } from './utils/metaParser';
import './styles/App.css';
import './styles/stands/stand1.css';
import './styles/stands/stand2.css';
import './styles/stands/stand3.css';

function App() {
  const [currentStand, setCurrentStand] = useState<Stand>(standsData[0]);
  const [selectedLight, setSelectedLight] = useState<Light | null>(null);
  const [selectedMode, setSelectedMode] = useState<Mode | null>(null);
  const [selectedModeMap, setSelectedModeMap] = useState<Record<string, number>>({});
  const [previewSelectedModeMap, setPreviewSelectedModeMap] = useState<Record<string, number>>({});
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showBlackScreen, setShowBlackScreen] = useState(false);
  const [activeSidebarTab, setActiveSidebarTab] = useState<'stand' | 'sound'>('stand');
  const [activeLampMap, setActiveLampMap] = useState<Record<string, number[]>>({});
  const [blinkingLampMap, setBlinkingLampMap] = useState<Record<string, number[]>>({});
  const [blinkState, setBlinkState] = useState(false);
  const [playingSoundId, setPlayingSoundId] = useState<number | null>(null);
  const [guardantDialogOpen, setGuardantDialogOpen] = useState(false);
  const [guardantDialogMessage, setGuardantDialogMessage] = useState('');
  const [isBackendLoading, setIsBackendLoading] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioBlobUrlRef = useRef<string | null>(null);
  const soundPlaybackGenerationRef = useRef(0);

  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setBlinkState((prev) => !prev);
    }, 550); // Мигание

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (imgRef.current && overlayRef.current) {
      const img = imgRef.current;
      const overlay = overlayRef.current;
      const updateOverlaySize = () => {
        overlay.style.width = img.offsetWidth + 'px';
        overlay.style.height = img.offsetHeight + 'px';
      };

      // Используем ResizeObserver для отслеживания изменений размера изображения
      const resizeObserver = new ResizeObserver(() => {
        updateOverlaySize();
      });

      resizeObserver.observe(img);

      // Также обновляем при загрузке
      if (img.complete) {
        updateOverlaySize();
      } else {
        img.addEventListener('load', updateOverlaySize);
      }

      return () => {
        resizeObserver.disconnect();
        img.removeEventListener('load', updateOverlaySize);
      };
    }
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<{ code: string; message: string }>('Backend-startup-error', (event) => {
        setIsBackendLoading(false);
        if (event.payload?.code === 'guardant_key_missing') {
          setGuardantDialogMessage(
            'Ключ ЭЦП не вставлен в компьютер или является недействительным. Убедитесь, что правильный ключ установлен в один из USB.'
          );
          setGuardantDialogOpen(true);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  useEffect(() => {
    // Скрыть loading через 3 секунды, если backend успешно стартовал (не было ошибки)
    const timer = setTimeout(() => {
      if (!guardantDialogOpen) {
        setIsBackendLoading(false);
      }
    }, 3000);

    return () => clearTimeout(timer);
  }, [guardantDialogOpen]);

  const getLightKey = (light: Light, standId: number = currentStand.id) => `${standId}-${light.id}-${light.image}`;

  const getActiveIndexes = (light: Light) => {
    return activeLampMap[getLightKey(light)] || [];
  };

  const getBlinkingIndexes = (light: Light) => {
    return blinkingLampMap[getLightKey(light)] || [];
  };

  const getModeLampIndexes = (mode: Mode) => {
    const activeIndexes = mode.activeLampIndexes || [];
    const blinkingIndexes = mode.blinkingLampIndexes || [];
    return { activeIndexes, blinkingIndexes };
  };

  const isFinalMode = (light: Light, mode: Mode): boolean => {
    return !!light.modes && mode.id === light.modes[light.modes.length - 1]?.id;
  };

  const normalizeIndexes = (indexes: number[]) => [...indexes].sort((a, b) => a - b);

  const findMatchingMode = (light: Light, activeIndexes: number[], blinkingIndexes: number[]): Mode | undefined => {
    if (!light.modes) return undefined;

    const normalizedActive = normalizeIndexes(activeIndexes);
    const normalizedBlinking = normalizeIndexes(blinkingIndexes);

    return light.modes.find((mode) => {
      const { activeIndexes: modeActive, blinkingIndexes: modeBlinking } = getModeLampIndexes(mode);
      const normalizedModeActive = normalizeIndexes(modeActive);
      const normalizedModeBlinking = normalizeIndexes(modeBlinking);

      return (
        normalizedActive.length === normalizedModeActive.length &&
        normalizedActive.every((value, index) => value === normalizedModeActive[index]) &&
        normalizedBlinking.length === normalizedModeBlinking.length &&
        normalizedBlinking.every((value, index) => value === normalizedModeBlinking[index])
      );
    });
  };

  const setActiveIndexesForLight = (light: Light, activeIndexes: number[], blinkingIndexes: number[] = []) => {
    const key = getLightKey(light);

    setActiveLampMap((prev) => ({
      ...prev,
      [key]: activeIndexes,
    }));

    setBlinkingLampMap((prev) => ({
      ...prev,
      [key]: blinkingIndexes,
    }));

    if (!selectedLight || selectedLight.id !== light.id) {
      return;
    }

    const matchedMode = findMatchingMode(light, activeIndexes, blinkingIndexes);
    if (matchedMode) {
      setSelectedMode(matchedMode);
      setSelectedModeMap((prev) => ({
        ...prev,
        [key]: matchedMode.id,
      }));
      return;
    }

    const finalMode = light.modes?.[light.modes.length - 1];
    if (finalMode) {
      setSelectedMode(finalMode);
      setSelectedModeMap((prev) => ({
        ...prev,
        [key]: finalMode.id,
      }));
      return;
    }

    setSelectedMode(null);
  };

  const getGroupedLampIndexes = (standId: number, lightId: number, index: number): number[] | null => {
    const groupedRanges: Record<string, Array<[number, number]>> = {
      '1-4': [[4, 6], [7, 9]],
      '2-1': [[5, 7], [8, 10]],
      '3-3': [[1, 9]],
      '3-4': [[3, 7], [8, 9]],
      '3-5': [[3, 11]],
      '3-7': [[4, 19]],
    };

    const key = `${standId}-${lightId}`;
    const ranges = groupedRanges[key];
    if (!ranges) return null;

    const matchedRange = ranges.find(([from, to]) => index >= from && index <= to);
    if (!matchedRange) return null;

    const [from, to] = matchedRange;
    return Array.from({ length: to - from + 1 }, (_, i) => from + i);
  };

  const toggleLamp = (light: Light, index: number) => {
    const key = getLightKey(light);
    const current = activeLampMap[key] || [];
    const groupedIndexes = getGroupedLampIndexes(currentStand.id, light.id, index);
    const targetIndexes = groupedIndexes ?? [index];

    const allActive = targetIndexes.every((i) => current.includes(i));
    const nextIndexes = allActive
      ? current.filter((i) => !targetIndexes.includes(i))
      : Array.from(new Set([...current, ...targetIndexes]));

    setActiveIndexesForLight(light, nextIndexes);
  };

  const applyModeToLight = (light: Light, mode: Mode) => {
    if (isFinalMode(light, mode)) {
      return;
    }

    const key = getLightKey(light);
    const { activeIndexes, blinkingIndexes } = getModeLampIndexes(mode);

    setActiveLampMap((prev) => ({
      ...prev,
      [key]: activeIndexes,
    }));

    setBlinkingLampMap((prev) => ({
      ...prev,
      [key]: blinkingIndexes,
    }));
  };

  const handleStandClick = (stand: Stand) => {
    if (stand.id === currentStand.id && activeSidebarTab === 'stand') return;

    setActiveSidebarTab('stand');
    setIsTransitioning(true);

    setTimeout(() => {
      setCurrentStand(stand);
      setSelectedLight(null);
      setSelectedMode(null);
      setTimeout(() => setIsTransitioning(false), 50);
    }, 200);
  };

  const handleSoundTabClick = () => {
    if (activeSidebarTab === 'sound') return;

    setActiveSidebarTab('sound');
    setSelectedLight(null);
    setSelectedMode(null);
  };

  const isPreviewLight = (light: Light) => currentStand.previewLights.some(l => l.id === light.id);

  const getSelectedModeForLight = (light: Light) => {
    const key = getLightKey(light);
    if (isPreviewLight(light)) {
      return previewSelectedModeMap[key];
    }
    return selectedModeMap[key];
  };

  const setSelectedModeForLight = (light: Light, modeId: number) => {
    const key = getLightKey(light);
    if (isPreviewLight(light)) {
      setPreviewSelectedModeMap((prev) => ({
        ...prev,
        [key]: modeId,
      }));
    } else {
      setSelectedModeMap((prev) => ({
        ...prev,
        [key]: modeId,
      }));
    }
  };

  const handleLightClick = async (light: Light, e: React.MouseEvent) => {
    e.stopPropagation();

    setSelectedLight(light);
    setSelectedMode(null);

    const savedModeId = getSelectedModeForLight(light);

    const restoreMode = (modes: Mode[] | undefined) => {
      if (savedModeId !== undefined && modes) {
        const savedMode = modes.find((mode) => mode.id === savedModeId);
        if (savedMode) {
          setSelectedMode(savedMode);
          if (!isFinalMode(light, savedMode)) {
            applyModeToLight(light, savedMode);
          }
        }
      }
    };

    if (!light.modes || light.modes.length === 0) {
      try {
        const metaPath = `assets/stand${currentStand.id}/TrafficLight${light.id}.meta`;
        const metaData = await parseMetaFile(metaPath);

        light.modes = metaData.modes;
        light.ledMap = metaData.ledMap;
        light.name = metaData.name || light.name;

        setSelectedLight({ ...light });
        restoreMode(metaData.modes);
      } catch (error) {
        console.error('Failed to load modes:', error);
      }
    } else {
      restoreMode(light.modes);
    }
  };

  const handleModeClick = (mode: Mode, light: Light) => {
    if (!light) return;

    setSelectedModeForLight(light, mode.id);
    setSelectedMode(mode);
    if (!isFinalMode(light, mode)) {
      applyModeToLight(light, mode);
    }
  };

  const handleClearSelection = () => {
    setSelectedLight(null);
    setSelectedMode(null);
  };

  const handleExit = () => {
    setShowBlackScreen(true);

    setTimeout(() => {
      window.close();
    }, 500);
  };

  const soundFiles = Array.from({ length: 19 }, (_, index) => index + 1);

  const soundButtonPositions = [
    { top: '13%', left: '1.4%' },
    { top: '17%', left: '1.4%' },
    { top: '27%', left: '1.4%' },
    { top: '35.5%', left: '1.4%' },
    { top: '39.5%', left: '1.4%' },
    { top: '44.5%', left: '1.4%' },
    { top: '47.3%', left: '1.4%' },
    { top: '50.3%', left: '1.4%' },
    { top: '54%', left: '1.4%' },
    { top: '65.8%', left: '1.4%' },
    { top: '68%', left: '1.4%' },
    { top: '70.3%', left: '1.4%' },
    { top: '93.3%', left: '1.4%' },
    { top: '94.9%', left: '1.4%' },
    { top: '96.4%', left: '1.4%' },
    { top: '98%', left: '1.4%' },
    { top: '78.6%', left: '1.4%' },
    { top: '81%', left: '1.4%' },
    { top: '83%', left: '1.4%' },
  ];

  const disposeCurrentSoundMedia = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
      audioRef.current = null;
    }
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current);
      audioBlobUrlRef.current = null;
    }
  };

  const stopSound = () => {
    soundPlaybackGenerationRef.current += 1;
    disposeCurrentSoundMedia();
    setPlayingSoundId(null);
  };

  const playSound = (soundId: number) => {
    if (playingSoundId === soundId) {
      stopSound();
      return;
    }

    soundPlaybackGenerationRef.current += 1;
    const generation = soundPlaybackGenerationRef.current;

    disposeCurrentSoundMedia();
    setPlayingSoundId(soundId);

    const soundPath = `${import.meta.env.BASE_URL}assets/soundAlarm/sound/${String(soundId).padStart(2, '0')}.mp3`;
    const soundUrl = new URL(soundPath, window.location.href).href;

    void (async () => {
      try {
        const res = await fetch(soundUrl);
        if (!res.ok) {
          throw new Error(`Sound fetch failed: ${res.status}`);
        }
        const blob = await res.blob();
        if (generation !== soundPlaybackGenerationRef.current) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        if (generation !== soundPlaybackGenerationRef.current) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        audioBlobUrlRef.current = objectUrl;

        const audio = new Audio(objectUrl);
        audioRef.current = audio;

        audio.onended = () => {
          if (audioBlobUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            audioBlobUrlRef.current = null;
          }
          audioRef.current = null;
          setPlayingSoundId(null);
        };

        audio.currentTime = 0;
        await audio.play();
      } catch (error) {
        console.error('Failed to play sound', error);
        if (generation === soundPlaybackGenerationRef.current) {
          disposeCurrentSoundMedia();
          setPlayingSoundId(null);
        }
      }
    })();
  };

  const headerText = activeSidebarTab === 'sound'
    ? ''
    : selectedLight ? selectedLight.name : 'Выберите светофор';

  const renderLampClick = (light: Light, index: number) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!selectedLight || selectedLight.id !== light.id) {
        handleLightClick(light, e);
        return;
      }

      setSelectedMode(null);
      toggleLamp(light, index);
    };
  };

  const getPreviewActiveLampIndexes = (light: Light, activeIndexes: number[]) => {
    if (light.activeLamps?.length === 1 && activeIndexes.length > 0) {
      return [0];
    }

    return activeIndexes;
  };

  const getPreviewActiveLampSrc = (light: Light, lamp: string, index: number) => {
    const currentModeId = getSelectedModeForLight(light);
    const currentMode = light.modes?.find(m => m.id === currentModeId);
    
    if (currentStand.id === 1 && light.id === 7 && currentMode?.number === 3 && index === 0) {
      return 'Sprite7.png';
    }
    return lamp;
  };

  const getPreviewActiveLampClass = (light: Light, index: number) => {
    const currentModeId = getSelectedModeForLight(light);
    const currentMode = light.modes?.find(m => m.id === currentModeId);
    
    if (currentStand.id === 1 && light.id === 8 && currentMode?.number === 2 && index === 0) {
      return 'active-lamp lamp' + (index + 1) + ' rotate-90';
    }
    return 'active-lamp lamp' + (index + 1);
  };

  const renderPreviewLampClick = (light: Light) => {
    return (e: React.MouseEvent) => {
      e.stopPropagation();

      if (!selectedLight || selectedLight.id !== light.id) {
        handleLightClick(light, e);
        return;
      }

      // Для preview: переключать режимы вместо произвольного включения
      if (selectedLight.modes && selectedLight.modes.length > 0) {
        const currentModeId = getSelectedModeForLight(selectedLight);
        const currentModeIndex = currentModeId !== undefined ? selectedLight.modes.findIndex(m => m.id === currentModeId) : -1;
        const nextModeIndex = (currentModeIndex + 1) % selectedLight.modes.length;
        const nextMode = selectedLight.modes[nextModeIndex];
        handleModeClick(nextMode, selectedLight);
      }
    };
  };

  if (showBlackScreen) {
    return <div className="black-screen" />;
  }

  return (
    <div className="app">
      {isBackendLoading && (
        <div className="loading-overlay">
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <div className="loading-text">Подключение к серверу...</div>
          </div>
        </div>
      )}
      {guardantDialogOpen && (
        <div className="guardant-dialog-overlay">
          <div className="guardant-dialog">
            <div className="guardant-dialog-title">Ошибка!</div>
            <div className="guardant-dialog-message">{guardantDialogMessage}</div>
          </div>
        </div>
      )}
      <div className="main-panel">
        <div className="header">
          <h1>{headerText}</h1>
        </div>

        <div className={`lights-area ${activeSidebarTab === 'sound' ? 'sound-mode' : ''}`}>
          {activeSidebarTab === 'sound' ? (
            <div className="sound-viewer">
              <div className="sound-viewer-scroll">
                <div className="sound-viewer-inner">
                  <img ref={imgRef} src="assets/soundAlarm/SystemSoundSignalingRailroad.png" alt="Звуковая сигнализация" />
                  <div ref={overlayRef} className="sound-buttons-overlay">
                    {soundFiles.map((soundId, index) => (
                      <button
                        key={soundId}
                        className={`sound-play-btn ${playingSoundId === soundId ? 'sound-stop-btn' : ''}`}
                        style={soundButtonPositions[index]}
                        aria-label={playingSoundId === soundId ? `Остановить звук ${soundId}` : `Воспроизвести звук ${soundId}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          playSound(soundId);
                        }}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div
                className={`main-lights stand${currentStand.id} ${isTransitioning ? 'stand-transitioning' : ''}`}
                onClick={handleClearSelection}
              >
                {currentStand.mainLights.map((light) => {
                  const activeIndexes = getActiveIndexes(light);
                  const blinkingIndexes = getBlinkingIndexes(light);

                  return (
                    <div
                      key={light.id}
                      className={`light-item ${selectedLight?.id === light.id ? 'selected' : ''}`}
                      onClick={(e) => handleLightClick(light, e)}
                    >
                      <img src={light.image} alt={light.name} className="traffic-light" />

                      {light.notActiveLamps?.map((lamp, index) => (
                        <img
                          key={`not-${light.id}-${index}`}
                          src={`assets/ui/${lamp}`}
                          alt="not active"
                          className={`not-active-lamp lamp${index + 1}`}
                          onClick={renderLampClick(light, index)}
                        />
                      ))}

                      {light.activeLamps?.map((lamp, index) => ({ lamp, index }))
                        .filter(({ index }) => activeIndexes.includes(index))
                        .map(({ lamp, index }) => (
                          <img
                            key={`act-${light.id}-${index}`}
                            src={`assets/ui/${lamp}`}
                            alt="active"
                            className={`active-lamp lamp${index + 1}`}
                          />
                        ))}

                      {light.activeLamps?.map((lamp, index) => ({ lamp, index }))
                        .filter(({ index }) => blinkingIndexes.includes(index) && blinkState)
                        .map(({ lamp, index }) => (
                          <img
                            key={`blink-${light.id}-${index}`}
                            src={`assets/ui/${lamp}`}
                            alt="blinking"
                            className={`active-lamp lamp${index + 1}`}
                          />
                        ))}

                      {selectedLight?.id === light.id && <div className="highlight" />}
                    </div>
                  );
                })}
              </div>

              <div className={`preview-area stand${currentStand.id}`}>
                <div
                  className={`preview-lights ${isTransitioning ? 'preview-transitioning' : ''}`}
                  onClick={handleClearSelection}
                >
                  {currentStand.previewLights.map((light) => {
                    const activeIndexes = getActiveIndexes(light);
                    const blinkingIndexes = getBlinkingIndexes(light);

                    return (
                      <div
                        key={light.id}
                        className={`preview-light-item ${selectedLight?.id === light.id ? 'selected' : ''}`}
                        onClick={(e) => handleLightClick(light, e)}
                      >
                        <img src={light.image} alt={light.name} className="small-traffic-light" />

                        {light.notActiveLamps?.map((lamp, index) => (
                          <img
                            key={`preview-not-${light.id}-${index}`}
                            src={`assets/ui/${lamp}`}
                            alt="not active"
                            className={`not-active-lamp lamp${index + 1}`}
                            onClick={renderPreviewLampClick(light)}
                          />
                        ))}

                        {light.activeLamps?.map((lamp, index) => ({ lamp, index }))
                          .filter(({ index }) => getPreviewActiveLampIndexes(light, activeIndexes).includes(index))
                          .map(({ lamp, index }) => {
                            const src = getPreviewActiveLampSrc(light, lamp, index);
                            const className = getPreviewActiveLampClass(light, index);

                            return (
                              <img
                                key={`preview-act-${light.id}-${index}`}
                                src={`assets/ui/${src}`}
                                alt="active"
                                className={className}
                              />
                            );
                          })}

                        {light.activeLamps?.map((lamp, index) => ({ lamp, index }))
                          .filter(({ index }) => blinkingIndexes.includes(index) && blinkState)
                          .map(({ lamp, index }) => (
                            <img
                              key={`preview-blink-${light.id}-${index}`}
                              src={`assets/ui/${lamp}`}
                              alt="blinking"
                              className={`active-lamp lamp${index + 1}`}
                            />
                          ))}

                        {selectedLight?.id === light.id && <div className="highlight-small" />}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>

        {activeSidebarTab === 'stand' && (
          <div className="scenario-wrapper">
            <div className="scenario-title">
              {selectedMode ? selectedMode.text : 'Режимы работы'}
            </div>

            <div className="scenario">
              {selectedLight?.modes?.length ? (
                <div className="modes-list">
                  {selectedLight.modes.map((mode) => {
                    const currentModeId = getSelectedModeForLight(selectedLight);
                    const isActive = currentModeId === mode.id;

                    return (
                      <button
                        key={mode.id}
                        className={`mode-btn ${isActive ? 'active' : ''}`}
                        onClick={() => handleModeClick(mode, selectedLight)}
                      >
                        <span className="mode-text">{mode.number}. {mode.text}</span>
                      </button>
                    );
                  })}
                </div>
              ) : selectedLight ? (
                <div className="modes-info">Нет режимов для выбранного светофора</div>
              ) : (
                <div className="modes-info">Выберите светофор для просмотра режимов</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="sidebar">
        <div className="stands-buttons">
          {standsData.map((stand) => (
            <button
              key={stand.id}
              className={`stand-btn ${activeSidebarTab === 'stand' && currentStand.id === stand.id ? 'active' : ''}`}
              onClick={() => handleStandClick(stand)}
            >
              СТЕНД {stand.id}
            </button>
          ))}

          <button
            className={`stand-btn sound-btn ${activeSidebarTab === 'sound' ? 'active' : ''}`}
            onClick={handleSoundTabClick}
          >
            Звуковая сигнализация
          </button>
        </div>

        <button className="exit-btn" onClick={handleExit}>
          ВЫХОД
        </button>
      </div>
    </div>
  );
}

export default App;
