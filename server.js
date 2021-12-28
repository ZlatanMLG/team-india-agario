const Domain = "http://agar";
const Port   = 777;

/* Инициализация сервисов */
let app = require('express')();
let server = require('http').Server(app);
let io = require('socket.io')(server,
{
    cors: {
        origin: Domain,
        methods: ["GET", "POST"],
        allowedHeaders: ["my-custom-header"],
        credentials: true
    }
});
let fs = require('fs');

/* Получить значение от числа по проценту */
function GetPercentage(percent, value)
{
    return value * (percent / 100);
} 

/* Игровые параметры */
const ROOM_NAME = "AGAR_IO";
const COLORS = [
    [255, 43, 43],
    [255, 43, 192],
    [230, 43, 255],
    [156, 43, 255],
    [65, 43, 255],
    [43, 135, 255],
    [43, 241, 255],
    [43, 255, 163],
    [43, 255, 75],
    [167, 255, 43],
    [255, 244, 43],
    [255, 149, 43],
    [255, 100, 43]
];
const Tile_Count = 1;
const Tile_Size = 1250;
const Map_Size = Tile_Count * Tile_Size;
const Food_Points_Count = 50 * Tile_Count;
const Min_Food_Points_Count = (50 * Tile_Count) * (50 / 100);
const Min_Edge_Distance = 35;
const Min_Player_Radius = 30;
const Max_Player_Radius = Map_Size / 4;
const Player_Scale_Multiply = 1.01;

/* Сгенерировать ID */
function GenerateID() 
{
    let result       = '';
    let words        = '0123456789qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM';
    let max_position = words.length - 1;
        for( i = 0; i <= 10; ++i ) {
            position = Math.floor ( Math.random() * max_position );
            result = result + words.substring(position, position + 1);
        }
    return result;
}

/* Убрать все HTML символы */
function EscapeHtml(text) 
{
    let map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

/* Отфильтровать никнейм */
function NicknameFilter(nickname) 
{
    return EscapeHtml(nickname);
}

/* Случайное значение */
function Random(min, max) 
{
    return Math.round(Math.random() * (max - min) + min);
}

/* Случайная точка спавна */
function RandomSpawnPoint()
{
    return Random(Min_Edge_Distance, Map_Size - Min_Edge_Distance);
}

/* Прототип объекта игрока */
const Player = function(nickname, socket_id)
{
    this.name    = nickname;
    this.color   = COLORS[Random(0, COLORS.length - 1)],
    this.id      = socket_id;
    this.x       = RandomSpawnPoint();
    this.y       = RandomSpawnPoint();
    this.radius  = Min_Player_Radius;
    this.speed   = 4;
    this.pos     = { x: this.x, y: this.y, z: 0 };
    this.alive   = true;
};

/* Объект управления едой */
const FoodPoints = new function()
{
    const Min_Radius = 5;
    const Max_Radius = 10;
    const Half_Amount = GetPercentage(50, Min_Food_Points_Count);

    // Список всей еды
    let food_points = {};

    /* Прототип еды */
    const food_point_proto = function(point_id)
    {
        this.id = point_id;
        this.radius = Random(Min_Radius, Max_Radius);
        this.color = COLORS[Random(0, COLORS.length - 1)];
        this.x = RandomSpawnPoint(); 
        this.y = RandomSpawnPoint();
    };

    /* Сгенерировать еду */
    this.Generate = (count = undefined) =>
    {
        // Если количество новой еды не указано
        if (!count)
        {
            // Задаём значение по умолчанию
            count = Food_Points_Count;
        }

        for (let i = 0; i < count; i++) 
        {
            let new_point_id = GenerateID();

            food_points[new_point_id] = new food_point_proto(new_point_id);
        }
    };

    /* Получить всю еду */
    this.GetAll = () =>
    {
        return food_points;
    };

    /* Получить количество еды */
    this.GetCount = () =>
    {
        return Object.keys(food_points).length;
    };

    /* Удалить объект еды */
    this.RemoveOne = (id) =>
    {
        delete food_points[id];
    };

    /* Проверка и онбовление списка еды */
    this.CheckAndUpdateCount = (socket) =>
    {
        // Если текущее кол-во еды меньше, чем 50 % от минимального кол-ва еды на карте
        if (this.GetCount() < Half_Amount)
        {
            // Генерируем новую еду
            this.Generate(Half_Amount);
            
            Server.RPC_UpdateFoodPoints(socket, this.GetAll());
        }
    };

    // Сгенерировать еду при инициализации
    this.Generate();
};

/* Объект сервера */
const Server = new function()
{
    // Объект, в котором хранятся все ЖИВЫЕ игроки на карте
    let players = {};

    /* Тип рассылки сообщений от сервера */
    const RPC_Mode = {
        local: "rpc_to_local",
        all: "rpc_to_all",
        all_except_local: "rpc_to_all_except_local"
    };

    /* Метод отправки сообщений клиентам */
    const RPC = (socket, rpc_mode, rpc_name, data) =>
    {
        switch (rpc_mode)
        {
            case RPC_Mode.local:
                socket.emit(rpc_name, data);
                break;
            case RPC_Mode.all:
                io.in(ROOM_NAME).emit(rpc_name, data);
                break;
            case RPC_Mode.all_except_local:
                socket.to(ROOM_NAME).emit(rpc_name, data);
                break;
            default:
                console.error("Unknown RPC mode.");
                break;
        }
    };

    /* Заспавнить игрока на карте */
    this.AddPlayer = (socket, nickname) =>
    {
        let socket_id = socket.client.id;
        let player = this.GetPlayer(socket_id);
        
        // Если игрок уже заспавнился
        if (player && player.alive) 
            return;

        // Создаём новый объект для игрока 
        player = new Player(NicknameFilter(nickname), socket_id);

        // Вносим нового игрока в общий список
        players[socket_id] = player;

        // Сообщаем всем о спавне нового игрока
        this.RPC_NewEnemy(socket, player);
    };

    /* Удалить игрока из общего списка */
    this.RemovePlayer = (id) =>
    {
        delete players[id];
    };

    /* Получить объект игрока из спика */
    this.GetPlayer = (id) =>
    {
        return players[id];
    };

    /* Обновить позицию игрока */
    this.UpdatePlayerPOS = (data) =>
    {
        let player = this.GetPlayer(data.id);

        player.pos = data.pos; 
        player.x   = data.x; 
        player.y   = data.y;
    };

    /* Обновить размер игрока */
    this.UpdatePlayerRadius = (player_id) =>
    {
        let player = this.GetPlayer(player_id);

        // Если размер игрока достиг максимума
        if (player.radius >= Max_Player_Radius)
        {
            // Больше не увеличиваем его размеры
            return;
        }

        // Увеличиваем размер игрока
        player.radius *= Player_Scale_Multiply;
    };

    /* Получить количество подключённых клиентов */
    this.GetOnline = () =>
    {
        // Получить игровую комнату
        let room = io.sockets.adapter.rooms.get(ROOM_NAME);
        
        // Если игровая комната не найдена
        // Значит она не создана, и игроков на сервере нет
        if (!room)
            return 0;
        
        // Возвращаем количество подключённых игроков
        return room.size;
    };

    /* Обновить онлайн */
    this.RPC_UpdateOnline = (socket) =>
    {
        RPC(socket, RPC_Mode.all, 'update_online', this.GetOnline());
    };

    /* Инициализировать карту и врагов при подключении к серверу */
    this.RPC_MapInit = (socket) =>
    {
        let socket_id = socket.client.id;

        // Данные для клиента
        let data = { 
            /* Параметры карты */
            map: {
                map_size: Map_Size,
                tile_size: Tile_Size,
                tile_count: Tile_Count,
                food_points: FoodPoints.GetAll(),
            },
            /* Отправить всех игроков, кроме локального (список всех врагов) */
            enemies: Object.values(players).filter(p => { return p.id !== socket_id }),
            /* ID локального игрока */
            local_id: socket_id,
            /* Значение увеличения радиуса игрока */
            server_settings: {
                player_scale_multiply: Player_Scale_Multiply,
                min_player_radius: Min_Player_Radius,
                max_player_radius: Max_Player_Radius
            }
        };

        RPC(socket, RPC_Mode.local, 'map_init', data);
    };

    /* Заспавнить игрока на карте */
    this.RPC_NewEnemy = (socket, player) =>
    {
        RPC(socket, RPC_Mode.all, 'new_enemy', player);
    };

    /* Игрок отключился */
    this.RPC_PlayerDisconnected = (socket) =>
    {
        let player_id = socket.client.id;

        RPC(socket, RPC_Mode.all_except_local, 'player_disconnected', {
            id: player_id,
            online: Server.GetOnline()
        });
        
        this.RemovePlayer(player_id);
    };

    /* Обновить позицию врага */
    this.RPC_UpdateEnemyPOS = (socket, data) =>
    {
        // Добавить к данным айди игрока, которому нужно обновить позицию
        data.id = socket.client.id;

        this.UpdatePlayerPOS(data);

        RPC(socket, RPC_Mode.all_except_local, 'update_enemy_pos', data);
    };

    /* Удалить объект еды */
    this.RPC_AteFood = (socket, data) =>
    {
        let ate_food_res = {
            player_id: socket.client.id,
            food_point_id: data
        };

        // Удалить объект еды из общего списка
        FoodPoints.RemoveOne(data);

        // Проверить, нужно ли пополнять список еды
        FoodPoints.CheckAndUpdateCount(socket);

        // Обновить размеры игрока
        this.UpdatePlayerRadius(ate_food_res.player_id);

        RPC(socket, RPC_Mode.all_except_local, 'someone_ate_food', ate_food_res);
    };

    /* Обновить список еды */
    this.RPC_UpdateFoodPoints = (socket, data) =>
    {
        RPC(socket, RPC_Mode.all, 'update_food_points', data);
    };
};

/* Клиент подключился */
io.on('connection', function(socket) 
{
    /* Подключить сокет к глобальной игровой комнате */
    socket.join(ROOM_NAME);

    /* Инициализировать карту у игрока */
    Server.RPC_MapInit(socket);

    /* Обновить общий онлайн */
    Server.RPC_UpdateOnline(socket);

    /* Обработка команд клиента */

    /* Игрок готов к спавну */
    socket.on('ready_to_spawn', function(data) 
    { 
        Server.AddPlayer(socket, data.name);
    });

    /* Обновить и отправить позицию игрока */
    socket.on('update_pos', function(data) 
    {
        Server.RPC_UpdateEnemyPOS(socket, data);
    });

    /* Игрок скушал объект еды */
    socket.on('ate_food', function(data) 
    {
        Server.RPC_AteFood(socket, data);
    });

    /* Игрок отключился */
    socket.on('disconnect', function() 
    {
        Server.RPC_PlayerDisconnected(socket);
    });
});

server.listen(Port);
console.log("Server was started.");