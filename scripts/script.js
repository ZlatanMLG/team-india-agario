"use strict";

// $(document).ready(function() { 
    $("#game_over, #score").hide();

    /* Получить значение от числа по проценту */
    function GetPercentage(percent, value)
    {
        return value * (percent / 100);
    } 

    /* Объект для взаимодействия с меню */
    const Menu = new function()
    {
        // Панель меню
        const panel = $(".bg_text");
        // Поле ввода никнейма
        const name_field = $("#set_name");
        // Кнопка начала игры
        const start_game_button = $("#start_game");

        /* Показать/Скрыть панель меню */
        this.SetActive = (state) =>
        {
            if (state)
            {
                panel.show();
                return;
            }

            panel.hide();
        };

        /* Получить введённый никнейм */
        this.GetEnteredPlayerName = () =>
        {
            let name = name_field.val();
            // Убрать лишние пробелы
            name = name.replace(/\s/g, ' ');
            
            // Если поле никнейма пустое
            if (!name)
            {
                console.warn("Name has not been entered.");
                // Здаём имя по умолчанию
                name = "Player";
            }

            return name;
        };

        /* Обработчик нажатия кнопки "Начать игру" */
        start_game_button.click(function() 
        { 
            // Не пускаем в бой, пока не убедимся, что игрок подключён к серверу
            if(!Server.GetConnectionState()) {
                alert("Server connection error.");
                return;
            }

            // Сообщаем серверу, что мы готовы к спавну
            Server.RPC_ReadyToSpawn( { name: Menu.GetEnteredPlayerName() });

            Menu.SetActive(false);
        });
    };

    /* Объект для Связи с сервером */
    const Server = new function()
    {
        const Domain = "http://agar";
        const Port = 777;
        const Ping = 100;

        // Подключить сокет к серверу
        const socket = io.connect(`${Domain}:${Port}`);

        // Элемент для отображения статуса подключения к серверу
        const state_indicator = $("#server_indicator");
        // Элемент для отображения онлайна
        const room_info = $("#room_info");

        // Время крайнего обновления позиции
        let last_POS_update = new Date().getTime();

        /* Получить состояние подключения к серверу */
        this.GetConnectionState = () =>
        {
            return socket.connected;
        };

        /* Обновить информацию о подключении к серверу */
        const UpdateConnectionState = (reason = undefined) =>
        {
            // Успешное подключение
            if (socket.connected)
            {
                console.log("Server connection established.");
                // Обновить текст индикатора
                state_indicator.text("Connected").css("color", "#00ff37");
                return;
            }

            console.error((!reason) ? "Disconnected." : reason);
            Menu.SetActive(true);
            // Обновить текст индикатора
            state_indicator.text("Disconnected").css("color", "#ff0000");
            // Обновить текст онлайна
            room_info.text("");
            GameManager.ClearAll();
        };

        /* Обновить онлайн */
        const UpdateOnline = (online) =>
        {
            room_info.text(`Current online: ${online}`);
        };

        // Remote Procedure Call (отправка сообщений серверу)
        const RPC = (rpc_name, params) =>
        {
            if (!socket.connected)
            {
                return console.error("[RPC] Connection error.");
            }

            socket.emit(rpc_name, params);
        };

        /* Клиент готов к спавну */
        this.RPC_ReadyToSpawn = function(params)
        {
            RPC("ready_to_spawn", params);
        };

        /* Обновить позицию локального игрока */
        this.RPC_UpdatePOS = function(params)
        {   
            // Текущее время
            let current_time = new Date().getTime();

            // Если разница во времени крайнего обновления позиции игрока
            // больше, чем время задержки между отправкой команды
            if ((current_time - last_POS_update) > Ping)
            {
                // Обновить крайнее время смены позиции
                last_POS_update = current_time;
                RPC("update_pos", params);
            } 
        };

        /* Локальный игрок скушал объект еды */
        this.RPC_AteFood = function(id)
        {
            RPC("ate_food", id);
        };

        /* Клиент подключился к серверу */
        socket.on('connect', () => 
        {
            UpdateConnectionState();
        });
    
        /* Ошибка переподключения к серверу */
        socket.io.on('reconnect_error', (error) => 
        {
            UpdateConnectionState("The server is down.");
        });
    
        /* Клиент отключился от сервера */
        socket.on('disconnect', (reason) => 
        {
            let my_reason = reason;

            if (reason === 'io server disconnect') 
            {
                my_reason = "You were kicked from the server.";
            } else if (reason === "transport close") 
            {
                my_reason = "Server connection has been lost.";
            }

            UpdateConnectionState(my_reason);
        });

        /* Инициализировать карту и игроков при подключении к серверу */
        socket.on('map_init', (res) => 
        {
            GameManager.OnMapInit(res);
        });

        /* Обновить онлайн */
        socket.on('update_online', (online) => 
        {
            UpdateOnline(online);
        });

        /* Спавн нового игрока */
        socket.on('new_enemy', function(new_enemy) 
        {
            GameManager.AddEnemy(new_enemy);
        });

        /* Игрок отключился */
        socket.on('player_disconnected', function(res) 
        {
            GameManager.RemoveEnemy(res.id);
            UpdateOnline(res.online);
        });

        /* Обновить позицию врага */
        socket.on('update_enemy_pos', function(res) 
        {
            GameManager.UpdateEnemyPOS(res);
        });

        /* Кто-то скушал еду */
        socket.on('someone_ate_food', function(data)
        {
            MapManager.RemoveOneFoodPoint(data.food_point_id);
            GameManager.OnUpdatePlayerRadius(data.player_id);
        });

        /* Обновить список еды */
        socket.on('update_food_points', function(data) 
        {
            MapManager.GenerateFoodPoints(data);
        });
    };

    /* Инициализировать движок PointJS */
    const Engine = new PointJS(0, 0, { backgroundColor: "rgb(233, 233, 233)" });
    const System = Engine.system;
    const Game   = Engine.game;
    const GetWH  = Game.getWH;
    const Camera = Engine.camera;
    const MouseControl = Engine.mouseControl;
    const KeyControl   = Engine.keyControl;
    const VectorPoint  = Engine.vector.point;    

    /* Объект для управления картой */
    const MapManager = new function()
    {
        let map_size;
        let tile_size;
        let tile_count;

        let food_points = {};
        let tiles = [];

        /* Получить размер карты */
        this.GetMapSize = () =>
        {
            return map_size;
        };

        /* Получить еду */
        this.GetFoodPoints = () =>
        {
            return food_points;
        };

        /* Удалить объект еды */
        this.RemoveOneFoodPoint = (id) =>
        {
            delete food_points[id];
        };

        /* Очистить карту */
        this.Clear = () =>
        {
            food_points = {};
            tiles = [];
        };

        const CreateTile = function(params)
        {
            return Game.newImageObject({ 
                file: `images/map_block_white.png`, 
                w: tile_size, 
                h: tile_size,
                x: params.x,
                y: params.y,
                alpha: 1
            });
        };

        const CreateBorderTile = function(params)
        {
            return Game.newImageObject({ 
                file: `images/map_block_white.png`, 
                w : tile_size, 
                h : tile_size,
                x: params.x,
                y: params.y,
                alpha: 0.4
            });
        };

        const CreateFoodPoint = function(params)
        {
            let food_point_proto = Game.newCircleObject({ 
                alpha: 0.9,
                radius: params.radius,
                x: params.x,
                y: params.y,
                fillColor: `rgb(${params.color[0]}, ${params.color[1]}, ${params.color[2]})`
            });

            food_point_proto.server_id = params.id;

            return food_point_proto;
        };

        /* Создать плитки */
        this.GenerateTiles = () =>
        {
            /* Создать плитки по оси X */
            for (let x = -1; x <= tile_count; x++) 
            {
                /* Создать плитки по оси Y */
                for (let y = -1; y <= tile_count; y++) 
                {
                    // Если это край карты
                    if (((y == -1 || y == tile_count) || (x == -1 || x == tile_count))) 
                    {
                        // Добавить плитку края карты
                        tiles.push(CreateBorderTile({ x: tile_size * x, y: tile_size * y }));
                    } 
                    else 
                    {
                        // Добавить основную плитку
                        tiles.push(CreateTile({ x: tile_size * x, y: tile_size * y }));
                    }
                }
            }
        };

        /* Сгенерировать еду */
        this.GenerateFoodPoints = (new_food_points) =>
        {
            food_points = {};

            /* Процедура создания элементов еды */
            for (let i in new_food_points) 
            {
                // Добавить текущий элемент еды в общий список
                food_points[i] = CreateFoodPoint(new_food_points[i]);
            }
        };

        /* Создать карту */
        this.CreateMap = (params) => 
        {
            // Очистить карту
            this.Clear();

            // Обновить значения карты
            map_size    = params.map_size;
            tile_size   = params.tile_size;
            tile_count  = params.tile_count;

            // Сгенерировать плитки
            this.GenerateTiles();

            // Сгенерировать еду
            this.GenerateFoodPoints(params.food_points);
        };

        /* Отрисовать плитки */
        this.DrawTiles = () => 
        {
            tiles.forEach((tile) =>
            {
                if (tile.isInCamera())
                    tile.draw(); 
            });
        };

        /* Отрисовать еду */
        this.DrawFoodPoints = () => 
        {
            for (let i in food_points) 
            {
                if (food_points[i].isInCamera())
                {
                    food_points[i].draw();
                    food_points[i].drawStaticBox();
                }
            }
        };
    };

    /* Игровой помощник */
    const GameManager = new function()
    {
        // Объект локального игрока
        let local_player = {};
        // Айди локального игрока
        let local_server_id;
        // Список всех других игроков
        let enemies = {};
        // Значение приблежения камеры
        let zoom = 1;
        // Кратность увеличения радиуса игрока
        let player_scale_multiply = 1;
        // Минимальный размер игрока
        let min_player_radius = 30;
        // Максимальный размер игрока
        let max_player_radius = 30;

        /* Инициализировать счётчик FPS */
        let fps_counter = Game.newTextObject({
            size: 12,
            color: "#33ff00",
            strokeColorText: "#156900",
            strokeWidthText: 0.3
        });

        /* Метод создания игрока */
        const CreatePlayer = function(params)
        {
            let player_proto = Game.newCircleObject({
                strokeWidth: 5,
                x: params.x,
                y: params.y,
                radius: params.radius,
                fillColor: `rgb(${params.color[0]}, ${params.color[1]}, ${params.color[2]})`, 
                strokeColor: `rgb(${params.color[0] - 20}, ${params.color[1] - 20}, ${params.color[2] - 20})`
            });

            player_proto.pos = params.pos;
            player_proto.server_id = params.id;
            player_proto.name = params.name;
            player_proto.color = params.color;
            player_proto.speed = params.speed;
            player_proto.alive = params.alive;
            player_proto.alive = params.alive;
            player_proto.text = Game.newTextObject({
                align: "center",
                size: 18,
                alpha: 1,
                color: "#fff",
                strokeWidthText: 0.3,
                style: "bold",
                text: params.name,
                shadowColor : "black", 
                shadowBlur : 1, 
                shadowX : 0, 
                shadowY : 0 
            });

            /* Если размеры игрока достигнули максимального значения */
            player_proto.RadiusIsPeaked = () =>
            {
                return (player_proto.radius >= max_player_radius);
            };

            /* Обновить радиус игрока */
            player_proto.UpdateRadius = () =>
            {
                // Если размеры игрока достигнули максимального значения
                if (player_proto.RadiusIsPeaked())
                {
                    // Не увеличивать радиус
                    return;
                }

                player_proto.scaleC(player_scale_multiply);
            };

            return player_proto;
        };

        /* Обновить размер врага */
        this.OnUpdatePlayerRadius = (player_id) =>
        {
            this.GetOneEnemy(player_id).UpdateRadius();
        };

        /* Получить объект локального игрока */
        this.GetLocalPlayer = () =>
        {
            return local_player;
        };

        /* Получить объект врага */
        this.GetOneEnemy = (server_id) =>
        {
            return enemies[server_id];
        };

        /* Получить список врагов */
        this.GetEnemies = () =>
        {
            return enemies;
        };

        /* Заспавить игрока */
        this.AddEnemy = (new_enemy) =>
        {
            // Если сервер заспавнил нового игрока
            // И новый игрок, это локальный игрок
            if (local_server_id && local_server_id == new_enemy.id)
            {
                // Запускаем спавн локального игрока
                this.OnServerSpawned(new_enemy);
                return;
            }

            // Спавним врага
            enemies[new_enemy.id] = CreatePlayer(new_enemy);
        };

        /* Удалить игрока */
        this.RemoveEnemy = (id) =>
        {
            delete enemies[id];
        };

        /* Очистить всё */
        this.ClearAll = () =>
        {
            local_server_id = undefined;
            local_player = {};
            enemies = {};
        };

        /* Инициализировать карту и врагов при подключении к серверу */
        this.OnMapInit = (res) =>
        {
            local_server_id = res.local_id;
            player_scale_multiply = res.server_settings.player_scale_multiply;
            min_player_radius = res.server_settings.min_player_radius;
            max_player_radius = res.server_settings.max_player_radius;

            // Запуск игрового цикла
            Game.setLoop("game");
            Game.start();

            // Активация игровых служб
            System.initFPSCheck();
            System.initFullPage();
            MouseControl.initControl();
            KeyControl.initControl();

            // Создание карты
            MapManager.CreateMap(res.map);

            let map_size = MapManager.GetMapSize() / 2;
            Camera.setPositionC(VectorPoint(map_size, map_size));

            // Инициализация других игроков
            res.enemies.forEach((enemy) =>
            {
                this.AddEnemy(enemy);
            });
        };

        /* Спавн локального игрока */
        this.OnServerSpawned = (params) =>
        {
            // Инициализация локального игрока
            local_player = CreatePlayer(params);
            // Переместить камеру на игрока
            Camera.setPositionC(local_player.getPositionC());

            // Скрыть меню
            Menu.SetActive(false);
            console.log("Client spawned!");
        };

        /* Обновить счётчик FPS */
        this.UpdateFPS = () =>
        {
            if (!local_player.alive)
                return;

            fps_counter.reStyle({ 
                text: "FPS: " + System.getFPS() + " | x: " + local_player.x.toFixed(0) + ", y: " + local_player.y.toFixed(0)
            });
            fps_counter.setPositionS(VectorPoint(10, GetWH().h - 15));
            fps_counter.draw();
        };

        /* Обновить приближение камеры */
        this.UpdateZoom = () =>
        {
            // Если была прокрутка колеса мыши вверх
            if (MouseControl.isWheel( "UP" ) && zoom < 4)
            {
                Camera.scale(VectorPoint(1.1, 1.1)); 
                zoom++;
            }
            // Если была прокрутка колеса мыши вниз
            else if (MouseControl.isWheel( "DOWN" ) && zoom > -20) 
            {
                Camera.scale(VectorPoint(0.9, 0.9)); zoom--;
            }
        };

        /* Обновить позицию врага */
        this.UpdateEnemyPOS = (params) =>
        {
            let enemy = this.GetOneEnemy(params.id);

            enemy.pos = params.pos;
            enemy.s_x = params.x;
            enemy.s_y = params.y;
        };

        /* Проверить пересечение еды с игроком */
        this.CheckFoodPointIntersect = () =>
        {
            // Получить всю еду
            let food_points = MapManager.GetFoodPoints();

            // Перебор еды
            for (let food in food_points)
            {
                // Текущая еда
                let current_food = food_points[food];

                // Если текущая еда в поле зрения камеры
                if (current_food.isInCamera())
                {
                    // Если локальный игрок жив,
                    // радиус не достиг максимума,
                    // и пересекается с бъектом еды
                    if (local_player.alive && !local_player.RadiusIsPeaked() && local_player.isIntersect(current_food))
                    {
                        // Удалить объект еды
                        MapManager.RemoveOneFoodPoint(current_food.server_id);
                        // Отправить на сервер сообщение об удалении текущей еды
                        // и увеличению радиуса локального игрока
                        Server.RPC_AteFood(current_food.server_id);
                        // Обновить радиус локального игрока
                        local_player.UpdateRadius();

                        // Перейти к следующему циклу
                        continue;
                    }

                    // Отрисовать еду
                    current_food.draw();
                    // current_food.drawStaticBox();
                }
            }
        };

        /* Обновить данные локального игрока */
        this.UpdateLocalPlayer = (new_pos) =>
        {
            // Проверить скушал ли игрок еду
            // если нет, отрисовать еду

            this.CheckFoodPointIntersect();
            // Если игрок не был заспавнен
            if (!local_player.alive)
                return;

            let map_size = MapManager.GetMapSize();
            let distance = local_player.getDistanceC(new_pos);

            // Обновить позицию локального игрока
            // если дистанция до новой точки больше дозволенного
            if (distance > GetPercentage(80, local_player.radius)) 
            {
                // Обновление скорости движения
                let new_speed = distance / local_player.radius;
                let max_speed = 3.85;

                // Ограничить максимальную скорость
                if (new_speed > max_speed)
                {
                    new_speed = max_speed;
                }

                // Задать текущую скорость
                local_player.speed = new_speed;

                // Обновить координаты позиции
                local_player.pos = new_pos;

                // Если игрок в пределах карты
                if ((local_player.x >= 8 && local_player.x <= map_size-8 && local_player.y >= 8 && local_player.y <= map_size-8) || (local_player.pos.x >= 8 && local_player.pos.x <= map_size-8 && local_player.pos.y >= 8 && local_player.pos.y <= map_size-8)) 
                {
                    // Отправить серверу данные о смене позиции
                    Server.RPC_UpdatePOS(
                    { 
                        pos: local_player.pos,
                        x: local_player.x,
                        y: local_player.y,
                    });
                    // Двигать игрока в центральную точку новой позиции
                    local_player.moveToC(local_player.pos, local_player.speed, local_player.speed);
                }

                // Обновление никнейма
                local_player.text.setSize(local_player.radius / 2);
                local_player.text.setPositionC(VectorPoint(local_player.x + local_player.radius, local_player.y + local_player.radius));
            }

            // Отрисовать локального игрока
            local_player.draw();
            // Отрисовать никнейм
            local_player.text.draw();

            // local_player.drawStaticBox();

            // Обновить позицию камеры
            Camera.follow(local_player, 15);
        };

        /* Обновить данные врагов */
        this.UpdateEnemies = () =>
        {
            // Перебор всех вражеских игроков
            for (let key in this.GetEnemies())
            {
                // Текущий враг
                let enemy = this.GetOneEnemy(this.GetEnemies()[key].server_id);

                // Задать координаты X и Y, если они повреждены
                if (isNaN(enemy.x) || isNaN(enemy.y))
                {
                    enemy.x = enemy.pos.x;
                    enemy.y = enemy.pos.y;
                }

                // Если игрок в поле зрения камеры
                if (enemy.isInCamera()) 
                {
                    let distance = enemy.getDistanceC(enemy.pos);

                    // Обновить позицию вражеского игрока
                    // если дистанция до новой точки больше дозволенного
                    if (distance > enemy.radius) 
                    {
                        // Обновление скорости движения
                        let new_speed = distance / enemy.radius;
                        let max_speed = 3.85;

                        // Ограничить максимальную скорость
                        if (new_speed > max_speed)
                        {
                            new_speed = max_speed;
                        }

                        // Задать текущую скорость
                        enemy.speed = new_speed;

                        let map_size = MapManager.GetMapSize();

                        // Если игрок в пределах карты
                        if ((enemy.x >= 8 && enemy.x <= map_size-8 && enemy.y >= 8 && enemy.y <= map_size-8) || (enemy.pos.x >= 8 && enemy.pos.x <= map_size-8 && enemy.pos.y >= 8 && enemy.pos.y <= map_size-8)) 
                        {
                            // Двигать игрока в центральную точку новой позиции
                            enemy.moveToC(enemy.pos, enemy.speed, enemy.speed);
                        }
                    } 

                    // Обновление никнейма
                    enemy.text.setSize(enemy.radius / 2);
                    enemy.text.setPositionC(VectorPoint(enemy.x + enemy.radius, enemy.y + enemy.radius));

                    // Отрисовать вражеского игрока
                    enemy.draw();
                    // Отрисовать никнейм
                    enemy.text.draw();

                    // enemy.drawDynamicBox();
                    continue;
                }

                // Если игрок вне поля зрения камеры
                // не двигать объект, а сразу переместить по нужным координатам
                enemy.x = enemy.s_x;
                enemy.y = enemy.s_y;
            }
        };
    };

    /* Запустить игровой цикл */
    Game.newLoop("game", function() 
    {
        /* Не обновлять игровую сцену, если отсутствует подключение к серверу */
        if (!Server.GetConnectionState())
        {
            return;
        }

        /* Обновление зума камеры */
        GameManager.UpdateZoom();

        /* Отрисовка карты */
        MapManager.DrawTiles();

        /* Отрисовка еды */
        // MapManager.DrawFoodPoints();

        /* Отрисовка других игроков */
        GameManager.UpdateEnemies();

        /* Отрисовка локального игрока */
        GameManager.UpdateLocalPlayer(MouseControl.getPosition());

        /* Отрисовка счётчика fps */
        GameManager.UpdateFPS();

    });

// }); // documentUploaded