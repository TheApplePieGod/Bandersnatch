f = open("openings.txt", "r")
w = open("openings.ts", "w")
for line in f:
    code = ""
    name = ""
    moves = []
    if line[4] == '"':
        i = 5
        while line[i] != '"':
            name += line[i]
            i += 1
        fields = line.split(',')
        code = fields[0]
        moves = [e.strip() for e in fields[len(fields) - 1].split(' ')]
    else:   
        fields = line.split(',')
        code = fields[0]
        name = fields[1].split(';')[0]
        moves = [e.strip() for e in fields[2].split(' ')]
    w.write('{ code: "' + code + '", name: "' + name + '", moves: [' + ''.join('"' + e + '"' + (', ' if i != len(moves) - 1 else '') for i, e in enumerate(moves)) + '] },\n')
