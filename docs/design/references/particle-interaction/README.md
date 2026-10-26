# Код для следа и инерционной симуляции

Адаптация A.1 в Grade описана в [adaptation.md](adaptation.md); проверенный результат и записи — в актуальном `emotion-roadmap-v2.md`. Ниже сохранено происхождение подготовленных исходников; сами демо целиком в приложение не подключаются.

Набор подготовлен 26 октября 2026. Это исходники для адаптации, а не автономные подключаемые компоненты. Точное задание и статусы лицензий: `docs/design/particle-interaction-task.md`.

`kinmary/Displacement.js`, `kinmary/vertex.glsl`, `kinmary/upstream-readme.md` получены из https://github.com/kinmary/cursor-particle-displacement (main). Оригинальный README объявляет MIT; сохранить сведения об авторе/источнике. Класс зависит от Experience, assets и debug-окружения исходника; не является автономным компонентом. Его карта следа не хранит физическую скорость каждой частицы.

`three/webgl_gpgpu_birds.html` и `three/GPUComputationRenderer.js` получены из https://github.com/mrdoob/three.js (dev), лицензия MIT приложена рядом. Пример показывает отдельные position/velocity shaders и ping-pong state, его поведение птиц в Grade не требуется. Production использует helper из уже установленной версии 0.186.1 с адаптированными uniforms и существующим renderer. Медиа, GUI и runtime-зависимости примера не скопированы. Эти справочные копии отдельно не запускались; проверена интегрированная адаптация.
