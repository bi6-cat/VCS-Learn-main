# BỘ CÂU HỎI PHỎNG VẤN DOCKER
### Kèm giải thích — bám theo nội dung báo cáo (Container, Image, Network, Volume, Compose, Swarm) + phần bổ sung (Bảo mật, BuildKit, Resource limit, Logging)

Cách dùng: mỗi câu hỏi có phần **Trả lời/giải thích** ngắn gọn để ôn nhanh, và nhiều câu có thêm **Tình huống thực tế** — dạng câu hỏi hay bị hỏi thêm để test tư duy xử lý sự cố chứ không chỉ thuộc lý thuyết.

---

## PHẦN 1 — KIẾN TRÚC & KHÁI NIỆM NỀN TẢNG

**1. Docker khác Virtual Machine ở điểm cốt lõi nào?**
Container chia sẻ chung kernel với Host OS, chỉ cô lập ở mức tiến trình (namespaces + cgroups), trong khi VM ảo hoá toàn bộ phần cứng và chạy Guest OS riêng qua Hypervisor. Vì vậy container khởi động bằng giây, nhẹ hơn nhiều, nhưng cô lập kém an toàn hơn VM (chung kernel = nếu kernel bị khai thác, ảnh hưởng toàn bộ host).

**2. Docker Daemon, Client, Registry giao tiếp với nhau như thế nào?**
Client gửi lệnh (vd `docker run`) dưới dạng HTTP request tới Daemon qua Unix socket `/var/run/docker.sock` (hoặc TCP nếu remote). Daemon kiểm tra image cục bộ, nếu chưa có thì pull từ Registry (Docker Hub hoặc private registry), sau đó tạo container thông qua containerd → runc.

**3. Container thực chất là gì? Có phải là một máy ảo thu nhỏ không?**
Không. Container chỉ là một **tiến trình (process) bình thường** chạy trực tiếp trên kernel host, được cô lập bằng namespaces (không gian tên) và giới hạn tài nguyên bằng cgroups. Không có kernel riêng, không có hypervisor.

**4. Kể tên các loại Linux Namespace mà Docker sử dụng và vai trò của từng loại.**
PID (cô lập cây tiến trình, tiến trình chính có PID=1), NET (cô lập mạng), MNT (cô lập filesystem), IPC (cô lập giao tiếp liên tiến trình), UTS (cô lập hostname), USER (cô lập user/UID).

**5. cgroups dùng để làm gì? Khác gì với namespaces?**
Namespaces quyết định container **"nhìn thấy gì"** (cô lập tầm nhìn), còn cgroups quyết định container **"được dùng bao nhiêu"** tài nguyên (CPU, RAM, I/O, băng thông). Hai cơ chế bổ trợ nhau: namespaces cô lập, cgroups giới hạn.

> **Tình huống:** Một container bị memory leak, không giới hạn RAM, kéo theo sập luôn các container khác trên cùng host. Nguyên nhân là gì và cách phòng tránh?
> → Do không cấu hình cgroups giới hạn RAM (`--memory`), container leak chiếm hết RAM host khiến kernel OOM Killer có thể giết nhầm cả tiến trình của container khác. Cách phòng tránh: luôn set `--memory`, `--memory-swap`, theo dõi bằng `docker stats`, dùng `restart policy` hợp lý.

---

## PHẦN 2 — IMAGE, LAYER, DOCKERFILE

**6. Cơ chế layer của Docker Image hoạt động như thế nào? Vì sao image tiết kiệm dung lượng khi build nhiều lần?**
Mỗi instruction trong Dockerfile tạo ra 1 layer read-only, các layer chồng lên nhau và được định danh bằng hash SHA256 (Content Addressable Storage). Nếu 2 image có layer giống hệt nhau (cùng hash), Docker chỉ lưu 1 bản vật lý và chia sẻ giữa các image/container → tiết kiệm đĩa.

**7. Copy-on-Write (CoW) là gì?**
Khi container cần sửa 1 file nằm ở layer read-only bên dưới, Docker không sửa trực tiếp mà **copy file đó lên container layer (writable)** rồi mới sửa. Layer gốc không bị thay đổi, vẫn dùng chung được cho container khác.

**8. Phân biệt CMD và ENTRYPOINT. Khi nào dùng kết hợp cả hai?**
`ENTRYPOINT` là lệnh gốc cố định, khó ghi đè (phải dùng `--entrypoint` để override). `CMD` là tham số mặc định, dễ bị ghi đè bằng cách truyền thêm ở cuối lệnh `docker run`. Kết hợp: `ENTRYPOINT ["python", "app.py"]` + `CMD ["--env=prod"]` → cho phép người dùng chỉ đổi tham số mà không đổi lệnh gốc.

**9. Docker build cache hoạt động ra sao? Vì sao đặt COPY mã nguồn sau cùng trong Dockerfile?**
Docker quét từng instruction, nếu instruction và các file liên quan (với COPY) không đổi so với lần build trước thì dùng lại cache layer. Nếu 1 layer bị thay đổi, mọi layer **từ đó trở xuống** phải build lại. Vì vậy nên đặt các bước ít thay đổi (cài dependency) lên trên, COPY mã nguồn (hay đổi nhất) xuống dưới để tận dụng cache tối đa.

**10. Multi-stage build giải quyết vấn đề gì?**
Cho phép dùng nhiều `FROM` để tách giai đoạn build (cần compiler, dependency nặng) và giai đoạn chạy (chỉ cần runtime + artifact), copy file cần thiết giữa các stage bằng `COPY --from=`. Kết quả: image cuối cùng nhỏ gọn, không mang theo build-tool và source code thừa.

> **Tình huống:** Image của bạn build xong nặng 1.2GB dù ứng dụng Node.js chỉ có vài trăm dòng code. Bạn sẽ tối ưu như thế nào?
> → Dùng base image nhẹ (`node:alpine` thay vì `node:latest`), multi-stage build tách `npm install`/build ra khỏi stage runtime, thêm `.dockerignore` loại bỏ `node_modules`/`.git`, gộp các RUN liên quan bằng `&&` để giảm số layer.

**11. Sự khác nhau giữa `docker rmi` báo lỗi "image is being used by container" — xử lý sao?**
Image đang được container (kể cả đã stop) tham chiếu tới thì không xoá được cho tới khi xoá container trước, hoặc dùng `-f` để ép xoá.

---

## PHẦN 3 — CONTAINER LIFECYCLE & VẬN HÀNH

**12. Vòng đời của 1 container gồm những trạng thái nào?**
Created → Running → (Paused) → Exited/Stopped → Removed. Paused là "đóng băng" toàn bộ tiến trình (CPU dừng xử lý nhưng RAM vẫn giữ), Exited là tiến trình chính đã bị kết thúc (SIGTERM/SIGKILL) nhưng writable layer vẫn còn cho tới khi bị `docker rm`.

**13. Khi gõ `docker stop`, chuyện gì xảy ra bên trong?**
Docker gửi `SIGTERM` cho tiến trình PID=1 trong container, chờ 1 khoảng thời gian (mặc định 10s) để ứng dụng tự dọn dẹp (đóng kết nối DB, flush buffer...), nếu quá thời gian mà chưa thoát thì gửi `SIGKILL` buộc dừng ngay.

**14. `docker kill` khác `docker stop` ở điểm nào?**
`kill` gửi thẳng `SIGKILL`, dừng ngay lập tức không cho ứng dụng kịp dọn dẹp; `stop` gửi `SIGTERM` trước, có thời gian ân hạn.

**15. Vì sao ứng dụng Node.js/Python chạy trực tiếp làm PID 1 lại có thể gặp vấn đề khi nhận SIGTERM?**
Nhiều runtime không tự xử lý signal đúng chuẩn khi làm PID 1 (PID 1 có hành vi đặc biệt trong Linux, một số signal handler mặc định bị bỏ qua), dẫn đến container không tắt gọn hoặc để lại zombie process. Giải pháp: chạy với cờ `--init` (chèn tini làm PID 1 thật, reap zombie đúng cách) hoặc dùng `ENTRYPOINT ["dumb-init", "--"]`.

> **Tình huống:** Container của bạn mất tới 10 giây mới dừng hẳn mỗi lần deploy, gây chậm CI/CD. Nguyên nhân có thể là gì?
> → Ứng dụng không xử lý SIGTERM (không có handler), Docker phải chờ hết timeout rồi mới SIGKILL. Cách khắc phục: thêm signal handler trong code, hoặc dùng `--init`/`dumb-init`, hoặc giảm `--stop-timeout` nếu chấp nhận kill cứng.

**16. `docker exec` khác `docker attach` như thế nào?**
`exec` tạo một tiến trình **mới** chạy song song trong namespace của container đang có (thường dùng vào shell debug). `attach` kết nối trực tiếp vào STDIN/STDOUT của tiến trình chính (PID 1) đang chạy — nếu bấm Ctrl+C có thể vô tình gửi signal làm chết container.

---

## PHẦN 4 — VOLUME & LƯU TRỮ DỮ LIỆU

**17. Vì sao cần Volume? Nếu không dùng thì chuyện gì xảy ra khi container bị xoá?**
Container vốn tạm thời (ephemeral) — dữ liệu nằm ở writable layer sẽ mất hoàn toàn khi container bị `docker rm`. Volume tách vòng đời dữ liệu ra khỏi vòng đời container, giúp dữ liệu tồn tại độc lập.

**18. Phân biệt Named Volume, Anonymous Volume, Bind Mount, Tmpfs.**
- Named Volume: có tên, Docker quản lý, tồn tại độc lập kể cả khi container bị xoá.
- Anonymous Volume: tên là hash ngẫu nhiên, dễ bị dọn theo khi xoá container với `-v`/`--rm` nếu không cấu hình giữ lại.
- Bind Mount: map trực tiếp 1 thư mục bất kỳ trên host vào container, phụ thuộc cấu trúc thư mục host, hay dùng cho dev (mount source code).
- Tmpfs: chỉ lưu trên RAM, mất khi container dừng, tốc độ I/O cực cao, dùng cho dữ liệu nhạy cảm/tạm thời (session, secret tạm).

**19. Volume nằm ở đâu trên host? Làm sao backup 1 volume?**
Named volume mặc định nằm ở `/var/lib/docker/volumes/<name>/_data`. Backup bằng cách mount volume đó vào 1 container tạm (thường dùng ubuntu/alpine), nén bằng `tar` rồi lưu ra ngoài host qua bind mount:
```bash
docker run --rm -v db_data:/volume -v $(pwd):/backup ubuntu tar cvf /backup/backup.tar /volume
```

> **Tình huống:** Sau khi chạy `docker compose down -v` production, toàn bộ dữ liệu database mất sạch. Vì sao và cách phòng tránh?
> → Cờ `-v` xoá luôn cả volume gắn với các container trong stack. Cách phòng tránh: tách biệt named volume quan trọng ra khỏi lifecycle của stack (dùng volume `external: true`), hạn chế quyền chạy `down -v` trên production, luôn có backup định kỳ.

---

## PHẦN 5 — NETWORK

**20. Giải thích luồng 1 gói tin đi từ container ra Internet (bridge network).**
Container gửi gói tin qua cặp veth vào docker0 bridge (switch ảo trên host) → iptables thực hiện MASQUERADE (NAT), đổi source IP nội bộ của container thành IP thật của host → gói tin đi tiếp qua router ra Internet.

**21. Port mapping (`-p`) hoạt động dựa trên cơ chế gì?**
DNAT (Destination NAT) qua iptables: request tới `host_ip:host_port` được chuyển hướng (đổi địa chỉ đích) thành `container_ip:container_port`.

**22. Vì sao 2 container trong default bridge network không gọi được nhau bằng tên, nhưng trong user-defined network thì được?**
Chỉ có user-defined network (`docker network create`) mới kích hoạt Embedded DNS Server (chạy ở `127.0.0.11` trong mỗi container), tự động phân giải tên container thành IP nội bộ. Default bridge network không có DNS này, buộc phải dùng IP cứng (dễ lỗi vì IP đổi mỗi lần container restart) hoặc `--link` (đã deprecated).

**23. Phân biệt các network driver: bridge, host, overlay, none, macvlan.**
- bridge: mặc định, container có IP riêng qua switch ảo docker0, cần port mapping để expose ra ngoài.
- host: dùng chung network namespace với host, port container = port host, không cần `-p`.
- overlay: nối nhiều Docker Daemon trên nhiều máy khác nhau thành 1 mạng ảo, dùng cho Swarm.
- none: không có network interface nào ngoài loopback, cô lập hoàn toàn.
- macvlan: cấp IP thật (MAC riêng) cho container như một máy vật lý trong mạng LAN, dùng khi cần container có IP cố định nhìn thấy từ toàn mạng.

> **Tình huống:** Bạn có 3 container: frontend, backend, database. Yêu cầu bảo mật: frontend không được phép truy cập trực tiếp database. Thiết kế network như thế nào?
> → Tạo 2 network riêng: `front-tier` (frontend + backend) và `back-tier` (backend + database). Backend nằm trong cả hai network nên đóng vai trò cầu nối; frontend và database không chung network nào nên không thể giao tiếp trực tiếp.

---

## PHẦN 6 — DOCKER COMPOSE

**24. `depends_on` trong Compose có đảm bảo service phụ thuộc đã "sẵn sàng" chưa?**
Không. Mặc định `depends_on` chỉ đảm bảo **thứ tự start container**, không đảm bảo ứng dụng bên trong đã sẵn sàng nhận kết nối (ví dụ MySQL container start trong 1s nhưng MySQL daemon cần 10–15s mới nhận query). Cần kết hợp `depends_on.condition: service_healthy` cùng với `HEALTHCHECK` được định nghĩa đúng.

**25. Phân biệt 3 condition của `depends_on`: service_started, service_healthy, service_completed_successfully.**
- `service_started`: chỉ chờ container start (mặc định).
- `service_healthy`: chờ tới khi HEALTHCHECK trả "healthy".
- `service_completed_successfully`: chờ container chạy xong và thoát với exit code 0 — dùng cho container init/migration chạy 1 lần trước khi service chính start.

**26. `docker compose down` và `docker compose down -v` khác nhau ra sao?**
`down` dừng và xoá container + network nhưng **giữ lại volume**. `down -v` xoá luôn cả volume → mất dữ liệu vĩnh viễn nếu không backup trước.

**27. Compose tìm file cấu hình theo thứ tự nào nếu không chỉ định `-f`?**
`compose.yaml` → `compose.yml` → `docker-compose.yaml` → `docker-compose.yml`.

> **Tình huống:** Bạn cần môi trường dev override một vài cấu hình (mount source code, bật debug port) mà không sửa file compose chính dùng chung cho production. Làm thế nào?
> → Dùng file `compose.override.yaml` (Compose tự động merge với file chính khi không chỉ định `-f` khác), hoặc dùng multi-file: `docker compose -f compose.yaml -f compose.dev.yaml up -d`.

---

## PHẦN 7 — DOCKER SWARM

**28. Vì sao cần Swarm khi đã có Compose?**
Compose chỉ chạy trên 1 máy. Swarm biến nhiều máy thành 1 cluster thống nhất, có self-healing (tự tạo lại container trên node khác khi node cũ chết), Routing Mesh + load balancing tích hợp, hỗ trợ rolling update gần như zero-downtime, và có cơ chế bầu lại Manager qua Raft.

**29. Quorum là gì? Vì sao luôn nên dùng số lẻ Manager?**
Quorum là điều kiện đa số (>50%) Manager phải đồng ý thì 1 quyết định (tạo/sửa service) mới được xác nhận. Số lẻ Manager (3, 5, 7) cho khả năng chịu lỗi tối ưu — ví dụ 4 Manager không chịu lỗi tốt hơn 3 (cùng chịu được mất 1 node để giữ quorum) mà lại tốn thêm 1 máy vô ích.

**30. Cluster mất quorum thì điều gì xảy ra?**
Cluster chuyển sang trạng thái read-only: các container/service **đang chạy vẫn tiếp tục chạy bình thường**, nhưng không thể tạo, sửa, hay scale service mới cho tới khi đủ quorum trở lại.

**31. Ba trạng thái của node trong thuật toán Raft là gì?**
Leader (duy nhất, nhận mọi request ghi và đồng bộ xuống các node khác), Follower (bị động, chỉ sao chép từ Leader), Candidate (trạng thái tạm thời khi 1 Follower không thấy Leader và tự ứng cử).

**32. Replicated mode và Global mode khác nhau ra sao? Cho ví dụ tình huống dùng mỗi loại.**
Replicated: khai báo số lượng replica cụ thể, Swarm rải đều qua các node available (không liên quan số lượng node). Ví dụ: web service cần 5 bản. Global: mỗi node đúng 1 container, không khai báo số lượng — dùng cho agent giám sát, log collector cần chạy trên **mọi** node (ví dụ `node-exporter` cho Prometheus).

**33. Routing Mesh hoạt động như thế nào?**
Khi publish port ở mode `ingress` (mặc định), **mọi node trong cluster** đều lắng nghe port đó dù node có chạy container của service hay không. Request đến bất kỳ node nào cũng được route nội bộ tới 1 container khoẻ mạnh của service tương ứng, nhờ overlay network + embedded DNS/load balancing built-in.

**34. Khác gì giữa publish port `mode=ingress` và `mode=host`?**
`ingress`: đi qua Routing Mesh, mọi node đều nhận và tự route request. `host`: chỉ node **đang thực sự chạy** container đó mới nhận request ở port này, không qua Routing Mesh — thường kết hợp với Global mode cho agent cần bind đúng port vật lý của từng node.

**35. `docker stack deploy` có build image từ Dockerfile được không?**
Không. Lệnh này không hỗ trợ `build:`. Mọi image dùng trong Stack phải được build sẵn và push lên 1 Docker Registry (Docker Hub, GitLab Registry, private registry...) để tất cả node trong cluster đều pull về được.

**36. `stop-first` và `start-first` trong rolling update khác nhau ra sao? Khi nào chọn cái nào?**
`stop-first` (mặc định): xoá container cũ trước rồi mới tạo mới → có khoảng downtime ngắn, nhưng tiết kiệm tài nguyên (không cần chạy song song 2 bản). `start-first`: tạo container mới trước, đợi healthy rồi mới xoá cũ → gần như zero-downtime, nhưng cần đủ tài nguyên chạy song song 2 bản trong lúc chuyển đổi.

**37. `docker service rollback` hoạt động ra sao? Có giới hạn gì?**
Quay service về **version ngay trước lần update gần nhất**. Swarm chỉ lưu 1 bước rollback gần nhất trong bộ nhớ cluster, không có lịch sử nhiều version như Helm/Kubernetes. Muốn quay về version xa hơn phải `docker service update --image <tag>` thủ công với tag cụ thể.

> **Tình huống:** Bạn vừa deploy bản update mới cho 1 service có 6 replica, nhưng phát hiện container mới liên tục unhealthy. Swarm sẽ hành xử ra sao nếu bạn đã cấu hình `failure_action: rollback`? Nếu chưa cấu hình thì sao?
> → Nếu đã cấu hình `update_config.failure_action: rollback` cùng healthcheck hợp lệ: Swarm tự phát hiện container mới fail healthcheck, tự động rollback về image cũ mà không cần can thiệp. Nếu chưa cấu hình (mặc định `pause`): Swarm dừng quá trình update giữa chừng, cần chạy thủ công `docker service rollback` hoặc `docker service update --image <tag_cu>`.

**38. Node bị "drain" nghĩa là gì? Khi nào dùng?**
`docker node update --availability drain <node>` khiến node đó không nhận task mới và di chuyển các task hiện có sang node khác. Thường dùng khi muốn bảo trì node, hoặc cấu hình Manager chỉ làm nhiệm vụ quản lý (không chạy workload) để tránh container ảnh hưởng tới hiệu năng quản lý cluster.

---

## PHẦN 8 — BẢO MẬT (bổ sung)

**39. Vì sao chỉ dùng `USER` trong Dockerfile để chạy non-root là chưa đủ an toàn?**
`USER` chỉ đổi UID chạy tiến trình, nhưng container mặc định vẫn giữ một tập Linux Capabilities khá rộng (có thể bị lợi dụng để leo thang quyền hoặc thoát container - container escape). Nên kết hợp thêm `--cap-drop=ALL` + chỉ add đúng quyền cần thiết, cùng `--security-opt no-new-privileges` để chặn leo thang quyền qua setuid binary.

**40. Vì sao không nên lưu mật khẩu DB qua biến môi trường (`environment:` trong Compose) ở production?**
Biến môi trường dễ bị lộ qua `docker inspect`, log crash, hoặc đọc trực tiếp `/proc/<pid>/environ`. Docker Secret (trong Swarm) mount giá trị dưới dạng file trong `/run/secrets/`, không xuất hiện trong `docker service inspect`, an toàn hơn nhiều.

**41. `--read-only` filesystem cho container có ý nghĩa gì và cần lưu ý gì khi bật?**
Khiến toàn bộ filesystem của container (trừ mount được khai báo rõ) không ghi được, giảm bề mặt tấn công nếu ứng dụng bị chiếm quyền. Cần khai báo thêm `--tmpfs /tmp` hoặc volume riêng cho những thư mục ứng dụng thực sự cần ghi (log, cache).

**42. Cách nhanh nhất để kiểm tra 1 image có lỗ hổng bảo mật (CVE) đã biết không?**
Dùng công cụ quét image như `docker scout cves <image>` hoặc Trivy, chạy trước khi đẩy image lên registry/production.

> **Tình huống:** Một pentest nội bộ phát hiện container ứng dụng của bạn có thể ghi đè file hệ thống bên trong chính container (không phải trên host) dẫn tới thực thi mã tuỳ ý. Bạn khắc phục thế nào ở tầng Docker runtime?
> → Áp dụng `--read-only` + `--tmpfs` cho thư mục cần ghi, `--cap-drop=ALL`, `--security-opt no-new-privileges`, chạy non-root user, và xem xét custom seccomp profile chặn thêm syscall không cần thiết.

---

## PHẦN 9 — BUILDKIT (bổ sung)

**43. BuildKit khác builder cũ (legacy) ở điểm gì đáng chú ý nhất?**
Hỗ trợ cache mount (cache thư mục dependency giữa các lần build mà không tạo layer dư), secret mount (đưa secret vào build mà không lưu vào layer image), build song song các stage độc lập nhanh hơn, và hỗ trợ multi-platform build.

**44. Vì sao dùng `ARG`/`ENV` để truyền secret (token, password) vào lúc build là không an toàn?**
Giá trị của `ARG`/`ENV` bị ghi lại vĩnh viễn trong lịch sử layer của image (`docker history` xem được), dù sau đó bạn xoá biến đi thì layer cũ vẫn còn lưu giá trị đó. Cách an toàn là dùng `RUN --mount=type=secret,id=...`, giá trị chỉ tồn tại trong quá trình build, không ghi vào layer cuối cùng.

---

## PHẦN 10 — LOGGING & RESOURCE (bổ sung)

**45. Vì sao log driver mặc định `json-file` có thể là một rủi ro vận hành?**
Mặc định không giới hạn dung lượng, log chạy lâu ngày (đặc biệt ứng dụng log nhiều hoặc bị lỗi loop) có thể làm đầy ổ đĩa host, ảnh hưởng tới toàn bộ hệ thống chứ không chỉ riêng container đó. Cần cấu hình `max-size`/`max-file` hoặc chuyển sang driver tập trung (fluentd, gelf, syslog).

**46. Container bị OOM Killed nghĩa là gì? Làm sao xác nhận và xử lý?**
Khi container vượt giới hạn RAM cấu hình (`--memory`), kernel OOM Killer sẽ giết tiến trình trong container để bảo vệ hệ thống. Xác nhận bằng `docker inspect <container> --format '{{.State.OOMKilled}}'` → `true`. Xử lý: tăng giới hạn RAM hợp lý, tối ưu ứng dụng (fix memory leak), hoặc thêm `restart policy` phù hợp để tự phục hồi.

**47. `HEALTHCHECK` trong Dockerfile có các tham số nào và ý nghĩa?**
`--interval` (chu kỳ check), `--timeout` (thời gian tối đa 1 lần check), `--retries` (số lần fail liên tiếp trước khi đánh dấu unhealthy), `--start-period` (thời gian ân hạn lúc mới start, fail trong giai đoạn này không tính vào retries).

---

## PHẦN 11 — CÂU HỎI TÌNH HUỐNG TỔNG HỢP (system design nhỏ)

**48. Thiết kế hệ thống Docker cho 1 ứng dụng web có Frontend, Backend API, Database, Cache, cần chịu lỗi và tự phục hồi khi 1 node chết. Bạn sẽ dùng công cụ gì và thiết kế network/volume ra sao?**
→ Dùng Docker Swarm (thay vì Compose đơn máy) để có self-healing + Routing Mesh; tách network 2 lớp (front-tier, back-tier) để cô lập database khỏi frontend; Database dùng Named Volume để dữ liệu bền vững độc lập container; cấu hình healthcheck cho từng service để đảm bảo depends_on hoạt động đúng nghĩa; thiết lập replica ≥2 cho service quan trọng để chịu lỗi 1 node.

**49. Ứng dụng chạy tốt trên máy dev nhưng lỗi khi lên môi trường Swarm production. Bạn debug theo thứ tự nào?**
→ (1) `docker service ps <service>` xem container có bị Rejected/exit code gì không; (2) `docker service logs <service>` xem log lỗi runtime; (3) kiểm tra image đã push đúng registry và tất cả node pull được chưa (vì Stack không tự build); (4) kiểm tra network/constraint/placement có đúng không; (5) kiểm tra healthcheck có quá strict khiến container bị coi unhealthy dù thực tế vẫn chạy được.

**50. Sự khác biệt quan trọng nhất cần lưu ý khi chuyển 1 hệ thống từ `docker compose up` (1 máy) sang `docker stack deploy` (Swarm) là gì?**
→ Stack không hỗ trợ `build:`, bắt buộc image phải build sẵn và push lên registry trước; một số field compose (như `container_name`, một số cấu hình network cụ thể) không có ý nghĩa trong Stack; cần bổ sung `deploy:` block (replicas, update_config, placement, resources) vốn bị bỏ qua khi chạy bằng Compose thường trên 1 máy.

---

## GỢI Ý CÁCH ÔN

- Với các câu lý thuyết thuần (1–47): học thuộc bản chất cơ chế, không chỉ thuộc lệnh — phỏng vấn thường hỏi "tại sao" nhiều hơn "lệnh gì".
- Với các câu tình huống (đánh dấu **Tình huống**): tập trả lời theo cấu trúc **Nguyên nhân → Cách xác nhận (lệnh kiểm chứng) → Cách khắc phục/phòng tránh**, đây là cách trả lời ghi điểm nhất khi phỏng vấn vị trí DevOps/Backend.
- Câu 48–50 dạng system design: nên vẽ nhanh sơ đồ kiến trúc trên giấy/whiteboard khi trả lời thay vì chỉ nói chay.
